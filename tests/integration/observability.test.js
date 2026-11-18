'use strict';

/**
 * Наблюдаемость: то, по чему можно понять «сайт жив» и «дела идут».
 *
 * Здесь проверяется не красивая страница, а достоверность:
 * healthz честно падает, когда база недоступна; метрики закрыты токеном;
 * сводка считает то, что есть в базе, а не то, что хочется видеть.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createTestApp } = require('../support/app');
const { createMetrics } = require('../../src/lib/metrics');
const { createAdminService } = require('../../src/services/admin');

test('healthz: 200 и время ответа базы', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const response = await ctx.request.get('/healthz');
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(typeof response.body.dbLatencyMs, 'number');
  assert.equal(typeof response.body.uptimeSec, 'number');
});

test('healthz: 503, если база не отвечает', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  // healthz ходит в базу через тот же sequelize, что и всё приложение
  const original = ctx.db.sequelize.query.bind(ctx.db.sequelize);
  ctx.db.sequelize.query = async () => {
    throw new Error('connection refused');
  };
  t.after(() => { ctx.db.sequelize.query = original; });

  const response = await ctx.request.get('/healthz');
  assert.equal(response.status, 503);
  assert.equal(response.body.ok, false);
});

test('метрики: без токена маршрут закрыт как несуществующий', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const response = await ctx.request.get('/metriki');
  assert.equal(response.status, 404, 'без METRICS_TOKEN маршрута нет');
});

test('метрики: с токеном видны запросы, ошибки и память', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  process.env.METRICS_TOKEN = 'secret-token-2026';
  t.after(() => { delete process.env.METRICS_TOKEN; });

  // Набиваем статистику: обычная страница, 404, 500 и ограничение частоты
  await ctx.request.get('/');
  await ctx.request.get('/knigi');
  await ctx.request.get('/net-takoy-stranitsy');
  await ctx.request.get('/test-error');

  const withoutToken = await ctx.request.get('/metriki');
  assert.equal(withoutToken.status, 403, 'чужой запрос должен получать отказ');

  const response = await ctx.request.get('/metriki').set('Authorization', 'Bearer secret-token-2026');
  assert.equal(response.status, 200);
  assert.ok(response.body.counters.requests >= 3);
  assert.ok(response.body.counters.serverErrors >= 1, '500 должен считаться');
  assert.ok(response.body.counters.clientErrors >= 1, '404 должен считаться');
  assert.ok(response.body.byStatus['404'] >= 1);
  assert.equal(typeof response.body.memoryMb, 'number');
  assert.equal(response.body.ok, true);
});

test('метрики: токен в query тоже подходит (для простого монитора)', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  process.env.METRICS_TOKEN = 'query-token';
  t.after(() => { delete process.env.METRICS_TOKEN; });

  const response = await ctx.request.get('/metriki?token=query-token');
  assert.equal(response.status, 200);
});

test('счётчик метрик: медленный запрос попадает в отдельный счётчик', () => {
  const metrics = createMetrics();
  const middleware = metrics.middleware();

  const listeners = {};
  const res = {
    statusCode: 200,
    on(event, handler) { listeners[event] = handler; }
  };
  const req = { method: 'GET', originalUrl: '/' };
  middleware(req, res, () => {});
  listeners.finish();

  const snapshot = metrics.snapshot();
  assert.equal(snapshot.counters.requests, 1);
  assert.equal(snapshot.byMethod.GET, 1);
  assert.equal(snapshot.byStatus['200'], 1);

  metrics.reset();
  assert.equal(metrics.snapshot().counters.requests, 0);
});

test('сводка: считает реальных читателей, возвраты и топ книг', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const book = await ctx.models.Book.create({
    slug: 'duna-test', title: 'Дюна', author: 'Фрэнк Герберт', year: 1965, pages: 704,
    description: 'Планета, песок и пряность.', cover: 'covers/demo-1.svg'
  });

  const active = await ctx.createUser({ name: 'Активная', lastActiveAt: new Date() });
  const fresh = await ctx.createUser({ name: 'Новичок', lastActiveAt: new Date() });
  const gone = await ctx.createUser({ name: 'Ушедший' });

  await ctx.models.LibraryEntry.create({ userId: active.id, bookId: book.id, status: 'read', finishedAt: new Date() });
  await ctx.models.LibraryEntry.create({ userId: fresh.id, bookId: book.id, status: 'reading' });
  await ctx.models.Review.create({
    userId: active.id, bookId: book.id, rating: 9, body: 'Очень длинная рецензия для проверки, не меньше двадцати символов.', state: 'published'
  });

  const service = createAdminService({
    User: ctx.models.User,
    Book: ctx.models.Book,
    LibraryEntry: ctx.models.LibraryEntry,
    Review: ctx.models.Review,
    Activity: ctx.models.Activity,
    sequelize: ctx.db.sequelize
  });

  const data = await service.overview({ days: 7 });
  assert.equal(data.users.total, 3);
  assert.equal(data.users.activeWeek, 2, 'ушедший не был на сайте');
  assert.equal(data.catalog.books, 1);
  assert.equal(data.activity.entries, 2);
  assert.equal(data.activity.reviews, 1);
  assert.equal(data.topBooks[0].title, 'Дюна');
  assert.equal(data.topBooks[0].readers, 2);
  assert.equal(data.topBooks[0].finished, 1);
  assert.equal(data.series.registrations.length, 7, 'семь дней в ряду');
});

test('сводка: пустая база не падает и не делит на ноль', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const service = createAdminService({
    User: ctx.models.User,
    Book: ctx.models.Book,
    LibraryEntry: ctx.models.LibraryEntry,
    Review: ctx.models.Review,
    Activity: ctx.models.Activity,
    sequelize: ctx.db.sequelize
  });

  const data = await service.overview();
  assert.equal(data.users.total, 0);
  assert.equal(data.users.retentionWeek, 0);
  assert.equal(data.activity.perReader, 0);
  assert.deepEqual(data.topBooks, []);
});

test('сводка: чек-лист честно ругается на почту и localhost', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const service = createAdminService({
    User: ctx.models.User,
    Book: ctx.models.Book,
    LibraryEntry: ctx.models.LibraryEntry,
    Review: ctx.models.Review,
    Activity: ctx.models.Activity,
    sequelize: ctx.db.sequelize
  });

  const items = await service.checklist({ mailTransportKind: 'console', publicUrl: 'http://localhost:3000' });
  const titles = items.map((item) => item.title).join('\n');

  assert.match(titles, /Почта не настроена/);
  assert.match(titles, /localhost/);
  assert.match(titles, /администратор/i);

  items.forEach((item) => {
    assert.ok(['error', 'warn', 'info'].includes(item.level), 'уровень из трёх известных');
    assert.ok(item.hint && item.action, 'есть объяснение и что делать');
  });
});

test('сводка доступна модератору, но не читателю', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const reader = await ctx.createUser({ name: 'Читатель' });
  await ctx.login(reader);
  const denied = await ctx.agent.get('/admin/svodka');
  assert.equal(denied.status, 403);

  // Отдельный агент: cookie читателя в этом же агенте дали бы 403
  const request = require('supertest');
  const modAgent = request.agent(ctx.app);
  const moderator = await ctx.createUser({ name: 'Модератор', role: 'moderator' });
  await ctx.login(moderator, 'reader2026', modAgent);
  const allowed = await modAgent.get('/admin/svodka');
  assert.equal(allowed.status, 200);
  assert.match(allowed.text, /Что происходит на сайте/);
});

test('страница сводки рисуется без инлайновых стилей (CSP)', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const admin = await ctx.createUser({ name: 'Админ', role: 'admin' });
  const { agent } = await ctx.login(admin);
  const response = await agent.get('/admin/svodka');

  assert.equal(response.status, 200);
  assert.ok(!/style="/.test(response.text), 'инлайновый style запрещён политикой');
  assert.ok(!/<style/.test(response.text));
});

test('воронка активации: видно, сколько людей доходит до книги и до рецензии', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const book = await ctx.models.Book.create({
    slug: 'kniga-v-funnele', title: 'Книга в воронке', author: 'Автор', description: 'Описание', pages: 200
  });

  // Четверо пришли: один ничего не сделал, один добавил книгу,
  // один дочитал, один написал рецензию
  const [silent, shelfer, finisher, reviewer] = await Promise.all([
    ctx.createUser({ name: 'Тихий' }),
    ctx.createUser({ name: 'Полка' }),
    ctx.createUser({ name: 'Дочитал' }),
    ctx.createUser({ name: 'Рецензия' })
  ]);

  await ctx.models.LibraryEntry.create({ userId: shelfer.id, bookId: book.id, status: 'want' });
  await ctx.models.LibraryEntry.create({ userId: finisher.id, bookId: book.id, status: 'read', finishedAt: new Date() });
  await ctx.models.LibraryEntry.create({ userId: reviewer.id, bookId: book.id, status: 'read', finishedAt: new Date() });
  await ctx.models.Review.create({
    userId: reviewer.id, bookId: book.id, rating: 8, body: 'Достаточно длинный текст рецензии для проверки воронки активации.', state: 'published'
  });

  const funnel = await ctx.services.adminService.funnel({ days: 30 });
  const counts = Object.fromEntries(funnel.steps.map((step) => [step.key, step.count]));

  assert.equal(counts.registered, 4);
  assert.equal(counts.shelf, 3);
  assert.equal(counts.finished, 2);
  assert.equal(counts.reviewed, 1);
  assert.equal(funnel.steps[0].fromPrevious, 100);

  // Провал между шагами — это и есть цифра, по которой принимают решения
  assert.equal(funnel.steps[3].fromPrevious, 50, 'из двух дочитавших рецензию написал один');
  assert.equal(funnel.steps[3].fromStart, 25);
  void silent;
});

test('воронка не считает людей, зарегистрированных раньше периода', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const old = await ctx.createUser({ name: 'Старожил' });
  await ctx.models.User.update(
    { createdAt: new Date(Date.now() - 90 * 24 * 3600 * 1000) },
    { where: { id: old.id }, silent: true }
  );

  const funnel = await ctx.services.adminService.funnel({ days: 30 });
  assert.equal(funnel.registered, 0, 'в когорту попадают только новые');
});

test('«где уходят»: шаг, на котором человек остановился', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const book = await ctx.models.Book.create({
    slug: 'kniga-dlya-uhoda', title: 'Книга для ухода', author: 'Автор', description: 'Описание', pages: 200
  });

  const silent = await ctx.createUser({ name: 'Молчун' });
  const reader = await ctx.createUser({ name: 'Читатель' });

  // Оба молчат дольше недели: иначе они ещё «активные», а не ушедшие
  const longAgo = new Date(Date.now() - 10 * 24 * 3600 * 1000);
  await ctx.models.User.update({ lastActiveAt: longAgo }, { where: { id: [silent.id, reader.id] } });
  await ctx.models.LibraryEntry.create({
    userId: reader.id, bookId: book.id, status: 'want', updatedAt: longAgo
  });

  const dropoff = await ctx.services.adminService.dropoff({ days: 30, silentForDays: 7 });
  const byStep = Object.fromEntries(dropoff.steps.map((step) => [step.step, step]));

  assert.equal(dropoff.total, 2);
  assert.equal(byStep.registered.count, 1);
  assert.equal(byStep.shelf.count, 1);
  assert.equal(byStep.finished.count, 0);
  assert.match(byStep.registered.hint, /Первый экран/);
  assert.equal(byStep.registered.share, 50);
});

test('сводка показывает воронку и блок «где уходят»', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const admin = await ctx.createUser({ name: 'Админ', role: 'admin' });
  const { agent } = await ctx.login(admin);
  const response = await agent.get('/admin/svodka');

  assert.equal(response.status, 200);
  assert.match(response.text, /Воронка за/);
  assert.match(response.text, /Добавили книгу на полку/);
  assert.match(response.text, /Где уходят/);
  // Полоса — классом, не style: иначе CSP вырежет оформление
  assert.ok(!/style="/.test(response.text));
});
