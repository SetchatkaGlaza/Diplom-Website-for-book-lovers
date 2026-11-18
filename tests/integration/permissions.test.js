'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createTestApp, extractCsrf } = require('../support/app');

/**
 * Права доступа: сорок с лишним попыток сделать чужое.
 *
 * Логика: у нас два человека — Анна (владелец данных) и Борис (посторонний).
 * Каждая строка таблицы — попытка Бориса (или гостя) тронуть данные Анны.
 * Ожидаем либо 403/404, либо редирект без изменения данных, но никогда —
 * успешное изменение.
 */

async function signIn(ctx, email, name, role = 'user') {
  const user = await ctx.createUser({ email, name, role });
  const agent = request.agent(ctx.app);
  await ctx.login(user, 'reader2026', agent);
  return { user, agent };
}

test('гость не попадает ни в один закрытый раздел', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const paths = [
    '/polka', '/nastroyki', '/lenta', '/chitateli', '/uvedomleniya', '/soobshcheniya',
    '/statistika', '/knizhnyy-god', '/start', '/import', '/eksport', '/kluby/novyy',
    '/admin/zhaloby', '/admin/polzovateli', '/knigi/novaya'
  ];

  for (const path of paths) {
    const response = await ctx.request.get(path);
    assert.equal(response.status, 303, `${path}: гостя должно уводить на вход`);
    assert.equal(response.headers.location, '/vhod', `${path}: неверный адрес входа`);
  }
});

test('гость не может писать: все POST-действия отклоняются', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const book = await ctx.models.Book.create({
    slug: 'duna', title: 'Дюна', author: 'Герберт', pages: 600, isPublished: true
  });
  const review = await ctx.models.Review.create({
    userId: 1, bookId: book.id, rating: 8, body: 'Текст рецензии для проверки прав доступа.'
  }).catch(() => null);

  const posts = [
    `/polka/${book.slug}/status`,
    `/polka/${book.slug}/progress`,
    `/polka/${book.slug}/favorite`,
    `/polka/${book.slug}/reread`,
    `/polka/${book.slug}/remove`,
    '/polka/tsel',
    `/knigi/${book.slug}/retsenziya`,
    `/knigi/${book.slug}/tsitata`,
    '/kluby',
    '/soobshcheniya',
    '/uvedomleniya/prochitat',
    '/zhaloba',
    '/nastroyki/profil',
    '/nastroyki/privatnost'
  ];
  if (review) posts.push(`/retsenziya/${review.id}/like`, `/retsenziya/${review.id}/komment`, `/retsenziya/${review.id}/udalit`);

  for (const path of posts) {
    const response = await ctx.request.post(path).type('form').send({ body: 'попытка' });
    assert.ok(
      [403, 303].includes(response.status),
      `${path}: гость получил ${response.status}`
    );
    if (response.status === 303) {
      assert.equal(response.headers.location, '/vhod', `${path}: должен уводить на вход`);
    }
  }

  // Ничего не изменилось
  assert.equal(await ctx.models.LibraryEntry.count(), 0);
  assert.equal(await ctx.models.Review.count(), review ? 1 : 0);
});

test('чужую полку, рецензию и диалог нельзя тронуть', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signIn(ctx, 'anna@example.com', 'Анна');
  const boris = await signIn(ctx, 'boris@example.com', 'Борис');

  const book = await ctx.models.Book.create({
    slug: 'duna', title: 'Дюна', author: 'Герберт', pages: 600, isPublished: true
  });
  await ctx.models.LibraryEntry.create({ userId: anna.user.id, bookId: book.id, status: 'reading' });
  const review = await ctx.models.Review.create({
    userId: anna.user.id, bookId: book.id, rating: 9, body: 'Рецензия Анны, которую Борис не должен удалить.'
  });

  const token = await extractCsrf((await boris.agent.get(`/knigi/${book.slug}`)).text);

  // Удаление чужой рецензии — 403
  const removeReview = await boris.agent.post(`/retsenziya/${review.id}/udalit`).type('form')
    .send({ _csrf: token });
  assert.equal(removeReview.status, 403, 'чужую рецензию удалить нельзя');
  assert.equal((await ctx.models.Review.findByPk(review.id)).body.length > 0, true);

  // Статус и прогресс чужой книги меняют только свою запись
  await boris.agent.post(`/polka/${book.slug}/status`).type('form')
    .send({ _csrf: token, status: 'read' });
  const annaEntry = await ctx.models.LibraryEntry.findOne({ where: { userId: anna.user.id } });
  assert.equal(annaEntry.status, 'reading', 'статус Анны не изменился');

  const borisEntry = await ctx.models.LibraryEntry.findOne({ where: { userId: boris.user.id } });
  assert.equal(borisEntry.status, 'read', 'у Бориса появилась своя запись');

  // Чужой профиль: закрытая статистика и полка
  await ctx.models.User.update({ isPrivate: true }, { where: { id: anna.user.id } });
  const stats = await boris.agent.get(`/chitateli/${anna.user.id}/statistika`);
  assert.equal(stats.status, 403, 'статистика закрытого профиля недоступна');

  // Чужой диалог
  const message = await ctx.services.socialService.sendMessage({
    senderId: anna.user.id, recipientId: boris.user.id, body: 'Личное сообщение'
  });
  const vera = await signIn(ctx, 'vera@example.com', 'Вера');
  const foreignDialog = await vera.agent.get(`/soobshcheniya/${message.conversation.id}`);
  assert.equal(foreignDialog.status, 404, 'чужой диалог не открывается');

  // Чужое уведомление прочитать нельзя — пометка идёт только по своим
  const note = await ctx.models.Notification.create({
    userId: anna.user.id, type: 'system', title: 'Личное уведомление', body: '', url: null
  });
  await boris.agent.post('/uvedomleniya/prochitat').type('form').send({ _csrf: token });
  const fresh = await ctx.models.Notification.findByPk(note.id);
  assert.equal(fresh.isRead, false, 'чужое уведомление осталось непрочитанным');
});

test('роли: модератор может скрыть, обычный пользователь — нет', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signIn(ctx, 'anna@example.com', 'Анна');
  const boris = await signIn(ctx, 'boris@example.com', 'Борис');
  const mod = await signIn(ctx, 'mod@example.com', 'Модератор', 'moderator');

  void anna;
  const book = await ctx.models.Book.create({
    slug: 'duna', title: 'Дюна', author: 'Герберт', pages: 600, isPublished: true
  });
  const review = await ctx.models.Review.create({
    userId: boris.user.id, bookId: book.id, rating: 6, body: 'Рецензия Бориса, на которую пожалуются.'
  });

  const annaToken = await extractCsrf((await anna.agent.get(`/knigi/${book.slug}`)).text);
  await anna.agent.post('/zhaloba').type('form').send({
    _csrf: annaToken, subjectType: 'review', subjectId: String(review.id), reason: 'Грубость в тексте рецензии'
  });
  const report = await ctx.models.Report.findOne();

  // Борис пытается сам закрыть жалобу на себя — 403
  const borisToken = await extractCsrf((await boris.agent.get('/polka')).text);
  const selfResolve = await boris.agent.post(`/admin/zhaloby/${report.id}`).type('form')
    .send({ _csrf: borisToken, action: 'reject' });
  assert.equal(selfResolve.status, 403, 'обычный пользователь не решает жалобы');

  // Модератор может
  const modPage = await mod.agent.get('/admin/zhaloby');
  const modToken = extractCsrf(modPage.text);
  const resolved = await mod.agent.post(`/admin/zhaloby/${report.id}`).type('form')
    .send({ _csrf: modToken, action: 'hide' });
  assert.equal(resolved.status, 303);
  assert.equal((await ctx.models.Review.findByPk(review.id)).state, 'hidden');
});

test('клубы: посторонний не читает закрытый клуб и не пишет в открытый', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signIn(ctx, 'anna@example.com', 'Анна');
  const boris = await signIn(ctx, 'boris@example.com', 'Борис');

  const closed = await ctx.services.clubService.create({
    ownerId: anna.user.id, name: 'Закрытый клуб', description: 'Только для своих, по приглашению.', isPrivate: true
  });
  const open = await ctx.services.clubService.create({
    ownerId: anna.user.id, name: 'Открытый клуб', description: 'Заходите все, читаем вместе по главам.'
  });

  const closedPage = await boris.agent.get(`/kluby/${closed.club.slug}`);
  assert.equal(closedPage.status, 403);

  const token = await extractCsrf((await boris.agent.get(`/kluby/${open.club.slug}`)).text);
  const write = await boris.agent.post(`/kluby/${open.club.slug}/obsuzhdenie`).type('form')
    .send({ _csrf: token, body: 'Хочу написать, но я не участник клуба' });
  assert.equal(write.status, 403, 'писать могут только участники');

  const edit = await boris.agent.post(`/kluby/${open.club.slug}/redaktirovat`).type('form')
    .send({ _csrf: token, name: 'Переименовал', description: 'Чужое описание клуба, изменённое без прав.' });
  assert.equal(edit.status, 403);
});

test('свой контент менять можно — проверка не блокирует владельца', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signIn(ctx, 'anna@example.com', 'Анна');
  const book = await ctx.models.Book.create({
    slug: 'duna', title: 'Дюна', author: 'Герберт', pages: 600, isPublished: true
  });

  const token = await extractCsrf((await anna.agent.get('/polka')).text);
  const status = await anna.agent.post(`/polka/${book.slug}/status`).type('form')
    .send({ _csrf: token, status: 'reading' });
  assert.equal(status.status, 303);

  const progress = await anna.agent.post(`/polka/${book.slug}/progress`).type('form')
    .send({ _csrf: token, pages: '100' });
  assert.ok([200, 303].includes(progress.status), `неожиданный код ${progress.status}`);

  const entry = await ctx.models.LibraryEntry.findOne({ where: { userId: anna.user.id } });
  assert.equal(entry.status, 'reading');
  assert.equal(entry.progressPages, 100);
});

test('гонка: два одновременных лайка дают один лайк', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signIn(ctx, 'anna@example.com', 'Анна');
  const book = await ctx.models.Book.create({
    slug: 'duna', title: 'Дюна', author: 'Герберт', pages: 600, isPublished: true
  });
  const review = await ctx.models.Review.create({
    userId: anna.user.id, bookId: book.id, rating: 9, body: 'Рецензия для проверки гонки лайков.'
  });

  const likes = await Promise.all([
    ctx.services.reviewService.toggleLike({ userId: anna.user.id, reviewId: review.id }),
    ctx.services.reviewService.toggleLike({ userId: anna.user.id, reviewId: review.id })
  ]);

  // Один из вызовов поставил, второй снял — но повторной строки в базе нет
  const likeRows = await ctx.models.ReviewLike.count({ where: { reviewId: review.id, userId: anna.user.id } });
  assert.ok(likeRows <= 1, 'лайк не должен размножаться');

  const fresh = await ctx.models.Review.findByPk(review.id);
  assert.equal(fresh.likesCount, await ctx.models.ReviewLike.count({ where: { reviewId: review.id } }),
    'счётчик совпадает с числом строк');
  void likes;
});

test('гонка: двойная запись прогресса не создаёт две записи на полке', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signIn(ctx, 'anna@example.com', 'Анна');
  const book = await ctx.models.Book.create({
    slug: 'duna', title: 'Дюна', author: 'Герберт', pages: 600, isPublished: true
  });
  void anna;

  const results = await Promise.all([
    ctx.services.shelfService.setStatus({ userId: anna.user.id, bookId: book.id, status: 'reading' }),
    ctx.services.shelfService.setStatus({ userId: anna.user.id, bookId: book.id, status: 'want' })
  ]);

  assert.equal(results.filter((result) => !result.error).length >= 1, true);
  assert.equal(
    await ctx.models.LibraryEntry.count({ where: { userId: anna.user.id, bookId: book.id } }),
    1,
    'на полке одна запись, а не две'
  );
});
