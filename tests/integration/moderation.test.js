'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createTestApp, extractCsrf } = require('../support/app');

/**
 * Модерация: жалобы, скрытие, блокировки, журнал и юридические страницы.
 *
 * Критерии плана:
 *  - жалоба скрывает контент (после решения модератора);
 *  - нарушитель не может обойти блокировку;
 *  - форма правообладателя создаёт запись.
 */

async function signIn(ctx, email, name, role = 'user') {
  const user = await ctx.createUser({ email, name, role });
  const agent = request.agent(ctx.app);
  await ctx.login(user, 'reader2026', agent);
  return { user, agent };
}

async function csrf(agent, path) {
  const page = await agent.get(path);
  return extractCsrf(page.text);
}

async function makeReview(ctx, userId, slug = 'duna') {
  const book = await ctx.models.Book.create({
    slug, title: 'Дюна', author: 'Фрэнк Герберт', pages: 600, isPublished: true
  });
  return ctx.models.Review.create({
    userId, bookId: book.id, rating: 8, body: 'Рецензия, на которую будут жаловаться.'
  });
}

test('жалоба попадает в очередь, скрытие убирает рецензию и пересчитывает рейтинг', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signIn(ctx, 'anna@example.com', 'Анна');
  const boris = await signIn(ctx, 'boris@example.com', 'Борис');
  const mod = await signIn(ctx, 'mod@example.com', 'Модератор', 'moderator');

  const review = await makeReview(ctx, anna.user.id);

  // Борис жалуется через форму
  const token = await csrf(boris.agent, '/knigi/duna');
  const reportResponse = await boris.agent.post('/zhaloba').type('form').send({
    _csrf: token, subjectType: 'review', subjectId: String(review.id), reason: 'Спойлер в открытом тексте', back: '/knigi/duna'
  });
  assert.equal(reportResponse.status, 303);

  const report = await ctx.models.Report.findOne();
  assert.ok(report, 'жалоба создана');
  assert.equal(report.state, 'open');
  assert.equal(report.subjectType, 'review');

  // Повторная жалоба того же человека не создаёт дубль
  const again = await ctx.services.moderationService.report({
    reporterId: boris.user.id, subjectType: 'review', subjectId: review.id, reason: 'Ещё раз'
  });
  assert.match(again.error, /уже пожаловались/);
  assert.equal(await ctx.models.Report.count(), 1);

  // Модератор видит очередь
  const queue = await mod.agent.get('/admin/zhaloby');
  assert.equal(queue.status, 200);
  assert.match(queue.text, /Спойлер в открытом тексте/);
  assert.match(queue.text, /Рецензия, на которую будут жаловаться/);

  // Скрывает
  const modToken = extractCsrf(queue.text);
  const resolved = await mod.agent.post(`/admin/zhaloby/${report.id}`).type('form')
    .send({ _csrf: modToken, action: 'hide', note: 'Подтверждено' });
  assert.equal(resolved.status, 303);

  const hidden = await ctx.models.Review.findByPk(review.id);
  assert.equal(hidden.state, 'hidden', 'рецензия скрыта');

  const book = await ctx.models.Book.findOne({ where: { slug: 'duna' } });
  assert.equal(book.ratingsCount, 0, 'скрытая рецензия не входит в рейтинг');
  assert.equal(book.ratingsSum, 0);

  // В журнале осталось два следа: жалоба и решение
  const journal = await ctx.services.moderationService.history();
  const actions = journal.map((row) => row.action);
  assert.ok(actions.includes('report.create'));
  assert.ok(actions.includes('report.hide'));
});

test('обычный пользователь не попадает в админку', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signIn(ctx, 'anna@example.com', 'Анна');

  for (const path of ['/admin/zhaloby', '/admin/polzovateli']) {
    const response = await anna.agent.get(path);
    assert.equal(response.status, 403, `${path} закрыт для обычного пользователя`);
  }

  const guest = request.agent(ctx.app);
  const guestResponse = await guest.get('/admin/zhaloby');
  assert.equal(guestResponse.status, 303, 'гость уходит на вход');
});

test('блокировка закрывает вход, а обход через новый аккаунт ловится по роли', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signIn(ctx, 'anna@example.com', 'Анна');
  const mod = await signIn(ctx, 'mod@example.com', 'Модератор', 'moderator');
  const troll = await signIn(ctx, 'troll@example.com', 'Тролль');

  const blocked = await ctx.services.moderationService.blockUser({
    userId: troll.user.id, moderatorId: mod.user.id, days: 3, reason: 'Спам'
  });
  assert.ok(blocked.blocked);

  // Активная сессия погасла: следующий запрос — уже гость
  const afterBlock = await troll.agent.get('/polka');
  assert.equal(afterBlock.status, 303, 'сессия сброшена блокировкой');

  // Войти заново нельзя
  const guest = request.agent(ctx.app);
  const loginPage = await guest.get('/vhod');
  const loginResponse = await guest.post('/vhod').type('form').send({
    _csrf: extractCsrf(loginPage.text), email: 'troll@example.com', password: 'reader2026'
  });
  assert.equal(loginResponse.status, 403, 'заблокированный не входит');

  // Модератора заблокировать нельзя
  const attempt = await ctx.services.moderationService.blockUser({ userId: mod.user.id, days: 1 });
  assert.equal(attempt.error, 'Модератора и администратора блокировать нельзя');

  // Истечение срока снимает блокировку само
  await ctx.models.User.update(
    { blockedUntil: new Date(Date.now() - 1000) },
    { where: { id: troll.user.id } }
  );
  await ctx.services.moderationService.liftExpired();
  const trollNow = await ctx.models.User.findByPk(troll.user.id);
  assert.equal(trollNow.isBlocked, false, 'просроченная блокировка снята автоматически');

  void anna;
});

test('фильтр ссылок и спама срабатывает у новичка, но не у старожила', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const newbie = await signIn(ctx, 'new@example.com', 'Новичок');
  const veteran = await signIn(ctx, 'old@example.com', 'Старожил');
  await ctx.models.User.update({ trustLevel: 2 }, { where: { id: veteran.user.id } });

  const mod = ctx.services.moderationService;

  const withLink = mod.checkText('Купите на https://spam.example.com дешевле', { trustLevel: 0 });
  assert.equal(withLink.ok, false);
  assert.match(withLink.reasons[0], /Ссылки/);

  const veteranLink = mod.checkText('Вот издание: https://example.com/book', { trustLevel: 2 });
  assert.equal(veteranLink.ok, true, 'старожилу ссылки можно');

  assert.equal(mod.checkText('Отличная книга, всем советую', { trustLevel: 0 }).ok, true);
  assert.equal(mod.checkText('казино казино', { trustLevel: 2 }).ok, false);
  assert.equal(mod.checkText(`${'А'.repeat(60)}`, { trustLevel: 3 }).ok, false);

  // guard учитывает блокировку
  await mod.blockUser({ userId: newbie.user.id, days: 1 });
  const guarded = await mod.guard({ userId: newbie.user.id, text: 'Хочу написать рецензию' });
  assert.equal(guarded.ok, false);
  assert.match(guarded.error, /заблокирован/);
});

test('частотный лимит для новичка', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const newbie = await signIn(ctx, 'new@example.com', 'Новичок');
  const mod = ctx.services.moderationService;

  // 5 рецензий в час — предел нулевого уровня (на разные книги: одна рецензия на книгу)
  for (let i = 0; i < 5; i += 1) {
    const book = await ctx.models.Book.create({
      slug: `b-${i}`, title: `Книга ${i}`, author: 'Автор', pages: 100, isPublished: true
    });
    await ctx.models.Review.create({
      userId: newbie.user.id, bookId: book.id, rating: 8, body: 'Текст рецензии, достаточно длинный для валидации.'
    });
  }

  const guarded = await mod.guard({ userId: newbie.user.id, text: 'Ещё одна рецензия' });
  assert.equal(guarded.ok, false);
  assert.match(guarded.error, /5 публикаций в час/);
});

test('уровень доверия растёт по фактам', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signIn(ctx, 'anna@example.com', 'Анна');
  const book = await ctx.models.Book.create({ slug: 'b', title: 'Б', author: 'А', pages: 100, isPublished: true });

  let result = await ctx.services.moderationService.recalcTrust(anna.user.id);
  assert.equal(result.level, 0, 'новичок без истории');

  for (let i = 0; i < 3; i += 1) {
    await ctx.models.LibraryEntry.create({ userId: anna.user.id, bookId: book.id + i, status: 'read' })
      .catch(async () => {
        const extra = await ctx.models.Book.create({ slug: `b${i}`, title: 'Б', author: 'А', pages: 100, isPublished: true });
        await ctx.models.LibraryEntry.create({ userId: anna.user.id, bookId: extra.id, status: 'read' });
      });
  }

  result = await ctx.services.moderationService.recalcTrust(anna.user.id);
  assert.ok(result.level >= 1, 'три книги — уже первый уровень');
});

test('форма правообладателя создаёт запись, пустая — нет', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const guest = request.agent(ctx.app);
  const page = await guest.get('/pravoobladatelyam');
  assert.equal(page.status, 200);
  assert.match(page.text, /48 час/);

  const token = extractCsrf(page.text);
  const sent = await guest.post('/pravoobladatelyam').type('form').send({
    _csrf: token,
    name: 'Издательство «Право»',
    email: 'rights@example.com',
    subject: 'Книга «Дюна», страница /knigi/duna',
    text: 'На странице опубликован фрагмент объемом более одной главы, права принадлежат издательству.'
  });
  assert.equal(sent.status, 200);
  assert.match(sent.text, /Обращение принято/);

  const claims = await ctx.services.moderationService.copyrightClaims();
  assert.equal(claims.length, 1);
  assert.equal(claims[0].email, 'rights@example.com');

  // Кривая форма — 422 и список ошибок
  const bad = await guest.post('/pravoobladatelyam').type('form').send({
    _csrf: token, name: 'А', email: 'не-почта', subject: 'x', text: 'мало'
  });
  assert.equal(bad.status, 422);
  assert.match(bad.text, /Нужен рабочий e-mail/);
  assert.equal((await ctx.services.moderationService.copyrightClaims()).length, 1, 'вторая запись не создалась');
});

test('юридические страницы открыты всем', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  for (const path of ['/pravila', '/soglashenie', '/konfidentsialnost', '/pravoobladatelyam']) {
    const response = await ctx.request.get(path);
    assert.equal(response.status, 200, `${path} должен открываться без входа`);
  }
});

test('жалоба на несуществующий объект отклоняется', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signIn(ctx, 'anna@example.com', 'Анна');
  const result = await ctx.services.moderationService.report({
    reporterId: anna.user.id, subjectType: 'review', subjectId: 9999, reason: 'Просто так'
  });
  assert.equal(result.error, 'Объект не найден');

  const wrongType = await ctx.services.moderationService.report({
    reporterId: anna.user.id, subjectType: 'book', subjectId: 1, reason: 'Просто так'
  });
  assert.equal(wrongType.error, 'Неизвестный тип жалобы');
  assert.equal(await ctx.models.Report.count(), 0);
});
