'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createTestApp, extractCsrf } = require('../support/app');

/**
 * Приёмка: 18 пользовательских сценариев, которые обычно проходят руками.
 *
 * Один тест — один путь человека по сайту. Так видно не «роут отвечает 200»,
 * а что сценарий целиком работает: нашёл книгу → добавил → отметил прогресс →
 * дочитал → написал рецензию → получил лайк.
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

async function seedBooks(ctx, count = 6) {
  const books = [];
  for (let i = 1; i <= count; i += 1) {
    books.push(await ctx.models.Book.create({
      slug: `kniga-${i}`,
      title: `Книга ${i}`,
      author: 'Автор Тестов',
      pages: 300,
      year: 2020 + (i % 5),
      isPublished: true
    }));
  }
  return books;
}

test('сценарий 1: гость открывает главную и понимает, что это', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  await seedBooks(ctx, 3);
  const home = await ctx.request.get('/');

  assert.equal(home.status, 200);
  assert.match(home.text, /Книгоманы/);
  assert.match(home.text, /войти|Войти/i);
  assert.match(home.text, /Каталог/);
});

test('сценарий 2: регистрация нового читателя', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const guest = request.agent(ctx.app);
  const form = await guest.get('/registratsiya');
  const token = extractCsrf(form.text);

  const registered = await guest.post('/registratsiya').type('form').send({
    _csrf: token,
    name: 'Новый Читатель',
    email: 'new@example.com',
    password: 'reader2026x',
    password_confirm: 'reader2026x'
  });

  assert.ok([303, 200].includes(registered.status), `регистрация вернула ${registered.status}`);
  const user = await ctx.models.User.findOne({ where: { email: 'new@example.com' } });
  assert.ok(user, 'пользователь создан');
  assert.notEqual(user.passwordHash, 'reader2026x', 'пароль хранится хешем');
});

test('сценарий 3: вход и выход', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await ctx.createUser({ email: 'anna@example.com', name: 'Анна' });
  const agent = request.agent(ctx.app);

  const loginPage = await agent.get('/vhod');
  const login = await agent.post('/vhod').type('form')
    .send({ _csrf: extractCsrf(loginPage.text), email: 'anna@example.com', password: 'reader2026' });
  assert.equal(login.status, 303);

  const shelf = await agent.get('/polka');
  assert.equal(shelf.status, 200);

  const logoutToken = await csrf(agent, '/polka');
  await agent.post('/vyhod').type('form').send({ _csrf: logoutToken });

  const afterLogout = await agent.get('/polka');
  assert.equal(afterLogout.status, 303, 'после выхода полка недоступна');
  void anna;
});

test('сценарий 4: поиск книги и добавление на полку', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const { agent } = await signIn(ctx, 'anna@example.com', 'Анна');
  await seedBooks(ctx, 5);

  const search = await agent.get('/knigi').query({ q: 'Книга 3' });
  assert.equal(search.status, 200);
  assert.match(search.text, /Книга 3/);

  const token = await csrf(agent, '/knigi/kniga-3');
  const added = await agent.post('/polka/kniga-3/status').type('form')
    .send({ _csrf: token, status: 'want' });
  assert.equal(added.status, 303);

  const shelf = await agent.get('/polka');
  assert.match(shelf.text, /Книга 3/);
});

test('сценарий 5: отметить прогресс и увидеть проценты', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const { agent } = await signIn(ctx, 'anna@example.com', 'Анна');
  await seedBooks(ctx, 2);

  const token = await csrf(agent, '/knigi/kniga-1');
  const progress = await agent.post('/polka/kniga-1/progress').type('form')
    .send({ _csrf: token, pages: '150' });

  assert.ok([200, 303].includes(progress.status));
  const entry = await ctx.models.LibraryEntry.findOne();
  assert.equal(entry.progressPages, 150);
  assert.equal(entry.status, 'reading', 'чтение началось автоматически');

  const shelf = await agent.get('/polka');
  assert.match(shelf.text, /50|150/);
});

test('сценарий 6: дочитать книгу — статус меняется сам', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const { agent } = await signIn(ctx, 'anna@example.com', 'Анна');
  await seedBooks(ctx, 2);

  const token = await csrf(agent, '/knigi/kniga-1');
  await agent.post('/polka/kniga-1/progress').type('form').send({ _csrf: token, pages: '300' });

  const entry = await ctx.models.LibraryEntry.findOne();
  assert.equal(entry.status, 'read', 'последняя страница закрывает книгу');
  assert.ok(entry.finishedAt, 'дата окончания записана');
});

test('сценарий 7: оценка и рецензия с защитой от спойлеров', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const { agent } = await signIn(ctx, 'anna@example.com', 'Анна');
  const [book] = await seedBooks(ctx, 1);

  const token = await csrf(agent, '/knigi/kniga-1/retsenziya');
  const published = await agent.post('/knigi/kniga-1/retsenziya').type('form').send({
    _csrf: token,
    rating: '4.5',
    title: 'Очень точная книга',
    body: 'Первая фраза без спойлера. Дальше идёт сюжетный поворот, который нельзя показывать всем подряд.'.repeat(3),
    hasSpoilers: '1'
  });
  assert.equal(published.status, 303);

  const review = await ctx.models.Review.findOne({ where: { bookId: book.id } });
  assert.ok(review);
  assert.equal(review.rating, 9, '4.5 звезды = 9 половинных шагов');

  const page = await agent.get('/knigi/kniga-1');
  assert.match(page.text, /4\.5 из 5/);
  assert.match(page.text, /details class="spoiler"/);
});

test('сценарий 8: лайк и комментарий к чужой рецензии', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signIn(ctx, 'anna@example.com', 'Анна');
  const boris = await signIn(ctx, 'boris@example.com', 'Борис');
  const [book] = await seedBooks(ctx, 1);

  const review = await ctx.models.Review.create({
    userId: anna.user.id, bookId: book.id, rating: 8,
    body: 'Рецензия Анны, которую Борис прочитает и прокомментирует.'
  });

  const token = await csrf(boris.agent, '/knigi/kniga-1');
  await boris.agent.post(`/retsenziya/${review.id}/like`).type('form')
    .set('Accept', 'application/json').send({ _csrf: token });
  await boris.agent.post(`/retsenziya/${review.id}/komment`).type('form')
    .send({ _csrf: token, body: 'Согласен, очень точная мысль' });

  const fresh = await ctx.models.Review.findByPk(review.id);
  assert.equal(fresh.likesCount, 1);
  assert.equal(await ctx.models.ReviewComment.count({ where: { reviewId: review.id } }), 1);

  const page = await boris.agent.get('/knigi/kniga-1');
  assert.match(page.text, /Согласен, очень точная мысль/);
});

test('сценарий 9: подписка на читателя и лента', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signIn(ctx, 'anna@example.com', 'Анна');
  const boris = await signIn(ctx, 'boris@example.com', 'Борис');
  const [book] = await seedBooks(ctx, 1);

  await ctx.services.socialService.record({ userId: boris.user.id, type: 'finished', bookId: book.id });

  const token = await csrf(anna.agent, `/chitateli/${boris.user.id}`);
  await anna.agent.post(`/chitateli/${boris.user.id}/podpiska`).type('form').send({ _csrf: token });

  const feed = await anna.agent.get('/lenta');
  assert.equal(feed.status, 200);
  assert.match(feed.text, /Борис/);
  assert.match(feed.text, /Книга 1/);
});

test('сценарий 10: личное сообщение и уведомление о нём', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signIn(ctx, 'anna@example.com', 'Анна');
  const boris = await signIn(ctx, 'boris@example.com', 'Борис');

  const token = await csrf(boris.agent, `/chitateli/${anna.user.id}`);
  const sent = await boris.agent.post('/soobshcheniya').type('form')
    .send({ _csrf: token, recipient: String(anna.user.id), body: 'Привет! Давайте читать вместе' });
  assert.equal(sent.status, 303);

  const inbox = await anna.agent.get('/soobshcheniya');
  assert.match(inbox.text, /Давайте читать вместе/);

  const notes = await anna.agent.get('/uvedomleniya');
  assert.match(notes.text, /сообщени/i);
});

test('сценарий 11: цель на год и статистика', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const { user, agent } = await signIn(ctx, 'anna@example.com', 'Анна');
  const [book] = await seedBooks(ctx, 1);

  await ctx.models.LibraryEntry.create({
    userId: user.id, bookId: book.id, status: 'read',
    progressPages: 300, finishedAt: new Date()
  });

  const token = await csrf(agent, '/polka');
  await agent.post('/polka/tsel').type('form').send({ _csrf: token, target: '12' });

  const stats = await agent.get('/statistika');
  assert.equal(stats.status, 200);
  assert.match(stats.text, /книг закрыто/);

  const year = await agent.get('/knizhnyy-god');
  assert.equal(year.status, 200);
  assert.match(year.text, /Ваш книжный год/);

  const card = await agent.get('/knizhnyy-god/kartinka?format=square');
  assert.equal(card.status, 200);
  assert.equal(card.headers['content-type'], 'image/png');
});

test('сценарий 12: цитата из книги', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const { agent } = await signIn(ctx, 'anna@example.com', 'Анна');
  await seedBooks(ctx, 1);

  const token = await csrf(agent, '/knigi/kniga-1');
  await agent.post('/knigi/kniga-1/tsitata').type('form')
    .send({ _csrf: token, body: 'Короткая цитата без полного текста.', pages: '42' });

  const quote = await ctx.models.Quote.findOne();
  assert.ok(quote);
  assert.equal(quote.body, 'Короткая цитата без полного текста.');
});

test('сценарий 13: онбординг за три шага', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const genre = await ctx.models.Genre.create({ slug: 'proza', name: 'Проза' });
  const [book] = await seedBooks(ctx, 1);
  await book.addGenre(genre);

  const { user, agent } = await signIn(ctx, 'anna@example.com', 'Анна');

  const step1Token = await csrf(agent, '/start');
  await agent.post('/start/zhanry').type('form').send({ _csrf: step1Token, zhanry: [String(genre.id)] });

  const step2Token = await csrf(agent, '/start?shag=knigi');
  await agent.post('/start/knigi').type('form')
    .send({ _csrf: step2Token, bookIds: [String(book.id)], zhanry: String(genre.id) });

  const step3Token = await csrf(agent, '/start?shag=tsel');
  const done = await agent.post('/start/tsel').type('form').send({ _csrf: step3Token, target: '12' });

  assert.equal(done.status, 303);
  assert.equal(done.headers.location, '/polka');
  assert.equal(await ctx.models.LibraryEntry.count({ where: { userId: user.id } }), 1);
  assert.equal((await ctx.models.ReadingGoal.findOne()).targetBooks, 12);
});

test('сценарий 14: клуб от создания до обсуждения по главам', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signIn(ctx, 'anna@example.com', 'Анна');
  const boris = await signIn(ctx, 'boris@example.com', 'Борис');
  const [book] = await seedBooks(ctx, 1);

  const createToken = await csrf(anna.agent, '/kluby/novyy');
  const created = await anna.agent.post('/kluby').type('form').send({
    _csrf: createToken,
    name: 'Читаем вместе',
    description: 'Клуб для тех, кто любит обсуждать книги по главам.'
  });
  assert.equal(created.status, 303);

  const club = await ctx.models.Club.findOne();
  await ctx.services.clubService.update({ clubId: club.id, userId: anna.user.id, currentBookId: book.id });

  const annToken = await csrf(anna.agent, `/kluby/${club.slug}`);
  await anna.agent.post(`/kluby/${club.slug}/obsuzhdenie`).type('form')
    .send({ _csrf: annToken, body: 'Начинаем с первой главы, читаем до пятницы', chapter: '1' });
  await anna.agent.post(`/kluby/${club.slug}/obsuzhdenie`).type('form')
    .send({ _csrf: annToken, body: 'В седьмой главе всё переворачивается с ног на голову', chapter: '7', hasSpoilers: '1' });

  // Борис вступает и на главе 2 не видит спойлер
  const joinToken = await csrf(boris.agent, `/kluby/${club.slug}`);
  await boris.agent.post(`/kluby/${club.slug}/vstupit`).type('form').send({ _csrf: joinToken });

  const page = await boris.agent.get(`/kluby/${club.slug}?glava=2`);
  assert.equal(page.status, 200);
  assert.match(page.text, /первой главы/);
  assert.ok(!page.text.includes('переворачивается'), 'спойлер скрыт');

  const late = await boris.agent.get(`/kluby/${club.slug}?glava=7`);
  assert.match(late.text, /переворачивается/, 'после седьмой главы спойлер открыт');
});

test('сценарий 15: приглашение в закрытый клуб', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signIn(ctx, 'anna@example.com', 'Анна');
  const boris = await signIn(ctx, 'boris@example.com', 'Борис');

  const { club } = await ctx.services.clubService.create({
    ownerId: anna.user.id,
    name: 'Тихий клуб',
    description: 'Закрытый клуб для медленного чтения без спешки.',
    isPrivate: true
  });

  const invite = await ctx.services.clubService.createInvite({ clubId: club.id, actorId: anna.user.id, days: 7 });
  const code = invite.invite.code;

  const guestView = await boris.agent.get(`/priglashenie/${code}`);
  assert.equal(guestView.status, 200);
  assert.match(guestView.text, /Тихий клуб/);

  const token = await csrf(boris.agent, `/priglashenie/${code}`);
  const joined = await boris.agent.post(`/priglashenie/${code}`).type('form').send({ _csrf: token });
  assert.equal(joined.headers.location, `/kluby/${club.slug}`);
});

test('сценарий 16: импорт полки из CSV', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const { user, agent } = await signIn(ctx, 'anna@example.com', 'Анна');
  await seedBooks(ctx, 3);

  const csv = [
    'Title,Author,My Rating,Exclusive Shelf,Number of Pages',
    'Книга 1,Автор Тестов,5,read,300',
    'Книга 2,Автор Тестов,4,to-read,300'
  ].join('\n');

  const token = await csrf(agent, '/import');
  const response = await agent.post('/import').type('form').send({ _csrf: token, file: csv });

  assert.equal(response.status, 200);
  assert.match(response.text, /Добавлено/);
  assert.equal(await ctx.models.LibraryEntry.count({ where: { userId: user.id } }), 2);

  const exported = await agent.get('/eksport');
  assert.equal(exported.status, 200);
  assert.match(exported.text, /Книга 1/);
});

test('сценарий 17: жалоба и решение модератора', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signIn(ctx, 'anna@example.com', 'Анна');
  const boris = await signIn(ctx, 'boris@example.com', 'Борис');
  const mod = await signIn(ctx, 'mod@example.com', 'Модератор', 'moderator');
  const [book] = await seedBooks(ctx, 1);

  const review = await ctx.models.Review.create({
    userId: boris.user.id, bookId: book.id, rating: 6,
    body: 'Спорная рецензия, на которую пожалуется Анна.'
  });

  const token = await csrf(anna.agent, '/knigi/kniga-1');
  await anna.agent.post('/zhaloba').type('form').send({
    _csrf: token, subjectType: 'review', subjectId: String(review.id), reason: 'Грубость и переход на личности'
  });

  const queue = await mod.agent.get('/admin/zhaloby');
  assert.match(queue.text, /Грубость и переход на личности/);

  const modToken = extractCsrf(queue.text);
  const report = await ctx.models.Report.findOne();
  await mod.agent.post(`/admin/zhaloby/${report.id}`).type('form')
    .send({ _csrf: modToken, action: 'hide', note: 'Подтверждено' });

  assert.equal((await ctx.models.Review.findByPk(review.id)).state, 'hidden');
  const journal = await ctx.services.moderationService.history();
  assert.ok(journal.some((row) => row.action === 'report.hide'));
});

test('сценарий 18: удаление аккаунта обезличивает данные', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const { user, agent } = await signIn(ctx, 'anna@example.com', 'Анна');

  const token = await csrf(agent, '/nastroyki');
  const removed = await agent.post('/nastroyki/udalit').type('form').send({
    _csrf: token,
    current_password: 'reader2026',
    confirm: 'УДАЛИТЬ'
  });

  assert.ok([303, 200].includes(removed.status), `удаление вернуло ${removed.status}`);

  const fresh = await ctx.models.User.findByPk(user.id);
  assert.ok(fresh.deletedAt || fresh.isBlocked, 'аккаунт помечен как удалённый');
  assert.ok(!fresh.email.includes('anna@example.com'), 'почта обезличена');

  const afterLogout = await agent.get('/polka');
  assert.equal(afterLogout.status, 303, 'в дневник больше не пускает');
});
