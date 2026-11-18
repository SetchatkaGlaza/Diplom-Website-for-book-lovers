'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createTestApp, extractCsrf } = require('../support/app');
const { progressPercent, clampPages } = require('../../src/services/shelf');

/**
 * Полка: статусы, прогресс, перечитывание и цель на год.
 * Всё проверяется через HTTP — так тесты ловят и ошибки маршрутов, и права доступа.
 */

async function makeBook(ctx, data = {}) {
  return ctx.models.Book.create({
    slug: data.slug || `kniga-${Math.random().toString(36).slice(2, 10)}`,
    title: data.title || 'Тестовая книга',
    author: data.author || 'Автор',
    pages: data.pages === undefined ? 200 : data.pages,
    isPublished: true
  });
}

/** Логин + CSRF-токен с нужной страницы. */
async function signIn(ctx, email = 'anna@example.com') {
  const user = await ctx.createUser({ email });
  await ctx.login(user);
  const page = await ctx.agent.get('/polka');
  return { user, token: extractCsrf(page.text) };
}

test('проценты прогресса: границы и деление на ноль', () => {
  assert.equal(progressPercent(0, 200), 0);
  assert.equal(progressPercent(100, 200), 50);
  assert.equal(progressPercent(200, 200), 100);
  assert.equal(progressPercent(250, 200), 100, 'больше книги — не больше 100%');
  assert.equal(progressPercent(-10, 200), 0, 'минус — это 0%');
  assert.equal(progressPercent(50, 0), 0, 'без известного объёма процентов нет');
  assert.equal(progressPercent(50, null), 0);

  assert.equal(clampPages(250, 200), 200);
  assert.equal(clampPages(-5, 200), 0);
  assert.equal(clampPages(37, 200), 37);
  assert.equal(clampPages('abc', 200), 0);
  assert.equal(clampPages(500, 0), 500, 'если страниц книги не знаем — не обрезаем');
});

test('полка: книга ставится кнопкой из каталога и появляется в списке', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const book = await makeBook(ctx, { slug: 'duna', title: 'Дюна', pages: 400 });
  const { token } = await signIn(ctx);

  const put = await ctx.agent.post('/polka/duna/status').type('form')
    .send({ _csrf: token, status: 'want', return_to: '/polka' });
  assert.equal(put.status, 303);

  const page = await ctx.agent.get('/polka');
  assert.equal(page.status, 200);
  assert.match(page.text, /Дюна/);
  assert.match(page.text, /Всего книг на полке: 1/);

  // Счётчик на книге тоже обновился
  const fresh = await ctx.models.Book.findByPk(book.id);
  assert.equal(fresh.shelvesCount, 1);
});

test('полка: четыре статуса, фильтр и счётчики совпадают с реальностью', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const books = [
    await makeBook(ctx, { slug: 'k-want', title: 'Хочу книгу' }),
    await makeBook(ctx, { slug: 'k-reading', title: 'Читаю книгу' }),
    await makeBook(ctx, { slug: 'k-read', title: 'Прочитал книгу' }),
    await makeBook(ctx, { slug: 'k-dnf', title: 'Бросил книгу' })
  ];
  const { user, token } = await signIn(ctx);

  const statuses = ['want', 'reading', 'read', 'dnf'];
  for (let i = 0; i < books.length; i += 1) {
    const response = await ctx.agent.post(`/polka/${books[i].slug}/status`).type('form')
      .send({ _csrf: token, status: statuses[i], return_to: '/polka' });
    assert.equal(response.status, 303);
  }

  // Счётчики на странице = данные в базе
  const page = await ctx.agent.get('/polka');
  for (const status of statuses) {
    const inDb = await ctx.models.LibraryEntry.count({ where: { userId: user.id, status } });
    assert.equal(inDb, 1);
    assert.match(page.text, new RegExp(`pill__count">1<`), `счётчик ${status} не совпал`);
  }
  assert.match(page.text, /Всего книг на полке: 4/);

  // Фильтр по статусу показывает одну книгу
  const reading = await ctx.agent.get('/polka').query({ status: 'reading' });
  assert.match(reading.text, /Читаю книгу/);
  assert.ok(!/Хочу книгу/.test(reading.text), 'в фильтре не должно быть книг из других статусов');

  // Мусор в фильтре не ломает страницу
  const junk = await ctx.agent.get('/polka').query({ status: 'chitayu' });
  assert.equal(junk.status, 200);
  assert.match(junk.text, /Всего книг на полке: 4/);
});

test('прогресс: страницы, проценты и границы', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  await makeBook(ctx, { slug: 'duna', title: 'Дюна', pages: 200 });
  const { user, token } = await signIn(ctx);

  // Отметка прогресса сама ставит книгу на полку в статус «читаю»
  const half = await ctx.agent.post('/polka/duna/progress').type('form')
    .set('Accept', 'application/json')
    .send({ _csrf: token, pages: '100' });
  assert.equal(half.status, 200);
  assert.equal(half.body.progressPages, 100);
  assert.equal(half.body.percent, 50);
  assert.equal(half.body.status, 'reading');
  assert.equal(half.body.finished, false);

  const entry = await ctx.models.LibraryEntry.findOne({ where: { userId: user.id } });
  assert.ok(entry.startedAt, 'дата начала должна появиться');

  // Больше книги — обрезается до объёма книги и закрывает книгу
  const over = await ctx.agent.post('/polka/duna/progress').type('form')
    .set('Accept', 'application/json')
    .send({ _csrf: token, pages: '9999' });
  assert.equal(over.body.progressPages, 200);
  assert.equal(over.body.percent, 100);
  assert.equal(over.body.status, 'read');
  assert.equal(over.body.finished, true);

  // Вернул назад — снова «читаю»
  const back = await ctx.agent.post('/polka/duna/progress').type('form')
    .set('Accept', 'application/json')
    .send({ _csrf: token, pages: '20' });
  assert.equal(back.body.percent, 10);
  assert.equal(back.body.status, 'reading');

  // Мусор вместо числа — понятная ошибка, а не 500
  const junk = await ctx.agent.post('/polka/duna/progress').type('form')
    .set('Accept', 'application/json')
    .send({ _csrf: token, pages: 'половина' });
  assert.equal(junk.status, 422);
  assert.match(junk.body.error, /числом/);

  // Отрицательное число не уводит прогресс в минус
  const negative = await ctx.agent.post('/polka/duna/progress').type('form')
    .set('Accept', 'application/json')
    .send({ _csrf: token, pages: '-30' });
  assert.equal(negative.body.progressPages, 0);
});

test('прогресс: обычная форма без скрипта перезагружает страницу', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  await makeBook(ctx, { slug: 'duna', title: 'Дюна', pages: 100 });
  const { token } = await signIn(ctx);

  // Без Accept: application/json — значит, человек без скрипта: нужен редирект
  const response = await ctx.agent.post('/polka/duna/progress').type('form')
    .send({ _csrf: token, pages: '40', return_to: '/polka' });
  assert.equal(response.status, 303);
  assert.equal(response.headers.location, '/polka');
});

test('перечитывание: счётчик растёт, книга снова «читаю»', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  await makeBook(ctx, { slug: 'duna', title: 'Дюна', pages: 200 });
  const { user, token } = await signIn(ctx);

  await ctx.agent.post('/polka/duna/status').type('form')
    .send({ _csrf: token, status: 'read', return_to: '/polka' });

  const first = await ctx.agent.post('/polka/duna/reread').type('form')
    .send({ _csrf: token, return_to: '/polka' });
  assert.equal(first.status, 303);

  let entry = await ctx.models.LibraryEntry.findOne({ where: { userId: user.id } });
  assert.equal(entry.rereadCount, 1);
  assert.equal(entry.status, 'reading');
  assert.equal(entry.progressPages, 0, 'перечитывание начинается с нуля');
  assert.equal(entry.finishedAt, null);

  await ctx.agent.post('/polka/duna/reread').type('form').send({ _csrf: token });
  entry = await ctx.models.LibraryEntry.findByPk(entry.id);
  assert.equal(entry.rereadCount, 2);
});

test('любимые книги и снятие с полки', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const book = await makeBook(ctx, { slug: 'duna', title: 'Дюна' });
  const { user, token } = await signIn(ctx);

  await ctx.agent.post('/polka/duna/status').type('form')
    .send({ _csrf: token, status: 'read', return_to: '/polka' });

  await ctx.agent.post('/polka/duna/favorite').type('form').send({ _csrf: token, return_to: '/polka' });
  let entry = await ctx.models.LibraryEntry.findOne({ where: { userId: user.id, bookId: book.id } });
  assert.equal(entry.isFavorite, true);

  await ctx.agent.post('/polka/duna/favorite').type('form').send({ _csrf: token });
  entry = await ctx.models.LibraryEntry.findByPk(entry.id);
  assert.equal(entry.isFavorite, false);

  const removed = await ctx.agent.post('/polka/duna/remove').type('form').send({ _csrf: token, return_to: '/polka' });
  assert.equal(removed.status, 303);
  assert.equal(await ctx.models.LibraryEntry.count({ where: { userId: user.id } }), 0);

  const fresh = await ctx.models.Book.findByPk(book.id);
  assert.equal(fresh.shelvesCount, 0, 'счётчик книг на полках пересчитан');
});

test('чужую полку изменить нельзя: каждый видит и меняет только своё', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  await makeBook(ctx, { slug: 'duna', title: 'Дюна' });

  // Анна ставит книгу себе
  const anna = await ctx.createUser({ email: 'anna4@example.com' });
  await ctx.login(anna);
  const annaToken = extractCsrf((await ctx.agent.get('/polka')).text);
  await ctx.agent.post('/polka/duna/status').type('form')
    .send({ _csrf: annaToken, status: 'reading' });
  assert.equal(await ctx.models.LibraryEntry.count({ where: { userId: anna.id } }), 1);

  // Борис в своём браузере ставит себе другой статус
  const boris = await ctx.createUser({ email: 'boris@example.com' });
  const borisAgent = request.agent(ctx.app);
  const loginPage = await borisAgent.get('/vhod');
  const borisToken = extractCsrf(loginPage.text);
  await borisAgent.post('/vhod').type('form')
    .send({ _csrf: borisToken, email: boris.email, password: 'reader2026' });

  const borisPolka = await borisAgent.get('/polka');
  // Пустая полка теперь показывает подсказки из каталога, поэтому проверяем
  // именно записи полки, а не упоминание названия на странице
  assert.ok(!borisPolka.text.includes('data-book="duna"'), 'чужая полка не видна');

  const borisCsrf = extractCsrf(borisPolka.text);
  await borisAgent.post('/polka/duna/status').type('form')
    .send({ _csrf: borisCsrf, status: 'want' });

  // У Анны статус не изменился
  const annaEntry = await ctx.models.LibraryEntry.findOne({ where: { userId: anna.id } });
  assert.equal(annaEntry.status, 'reading');
  assert.equal(await ctx.models.LibraryEntry.count(), 2, 'у каждого своя запись');
});

test('гость на полку не попадает', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  await makeBook(ctx, { slug: 'duna', title: 'Дюна' });

  const page = await ctx.request.get('/polka');
  assert.equal(page.status, 303);
  assert.equal(page.headers.location, '/vhod');

  const post = await ctx.request.post('/polka/duna/progress').type('form').send({ pages: '10' });
  assert.equal(post.status, 403, 'без токена даже не доходит до проверки входа');
  assert.equal(await ctx.models.LibraryEntry.count(), 0);
});

test('цель на год: ставится, сохраняется и считается', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const books = [
    await makeBook(ctx, { slug: 'k1', title: 'Первая', pages: 100 }),
    await makeBook(ctx, { slug: 'k2', title: 'Вторая', pages: 100 }),
    await makeBook(ctx, { slug: 'k3', title: 'Третья', pages: 100 })
  ];
  const { user, token } = await signIn(ctx);

  const set = await ctx.agent.post('/polka/tsel').type('form').send({ _csrf: token, target: '2' });
  assert.equal(set.status, 303);

  // Прочитал одну — на странице видно 1 из 2 и 50%
  await ctx.agent.post('/polka/k1/status').type('form')
    .send({ _csrf: token, status: 'read' });

  const page = await ctx.agent.get('/polka');
  assert.match(page.text, /из 2 книг/);
  assert.match(page.text, /50%/);

  // Прочитал вторую — цель выполнена
  await ctx.agent.post('/polka/k2/status').type('form').send({ _csrf: token, status: 'read' });
  const done = await ctx.agent.get('/polka');
  assert.match(done.text, /Цель выполнена/);

  // Книги прошлого года в цель не попадают
  const pastYear = await ctx.models.LibraryEntry.findOne({ where: { userId: user.id, bookId: books[2].id } });
  assert.equal(pastYear, null, 'третья книга ещё не читалась');

  // Кривые значения цели отклоняются
  for (const target of ['0', '-5', 'abc', '5000']) {
    const response = await ctx.agent.post('/polka/tsel').type('form').send({ _csrf: token, target });
    assert.equal(response.status, 303);
  }
  const goal = await ctx.models.ReadingGoal.findOne({ where: { userId: user.id } });
  assert.equal(goal.targetBooks, 2, 'кривые значения не должны менять цель');
});

test('цель на год считает только книги текущего года', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const book = await makeBook(ctx, { slug: 'staraya', title: 'Старая', pages: 100 });
  const author = await ctx.createUser({ email: 'dina@example.com' });
  await ctx.models.LibraryEntry.create({
    userId: author.id,
    bookId: book.id,
    status: 'read',
    finishedAt: new Date(Date.UTC(2020, 5, 1))
  });
  await ctx.models.ReadingGoal.create({ userId: author.id, year: new Date().getFullYear(), targetBooks: 10 });

  const agent = request.agent(ctx.app);
  const login = await agent.get('/vhod');
  await agent.post('/vhod').type('form')
    .send({ _csrf: extractCsrf(login.text), email: author.email, password: 'reader2026' });

  const page = await agent.get('/polka');
  assert.match(page.text, /из 10 книг/);
  assert.ok(!/100%/.test(page.text.split('goal-card')[1] || ''), 'старая книга не должна закрывать цель');
});

test('полка: редирект после действия не уводит на чужой сайт', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  await makeBook(ctx, { slug: 'duna', title: 'Дюна' });
  const { token } = await signIn(ctx);

  for (const evil of ['//evil.example', 'https://evil.example', '/\\evil.example', 'javascript:alert(1)']) {
    const response = await ctx.agent.post('/polka/duna/status').type('form')
      .send({ _csrf: token, status: 'want', return_to: evil });
    assert.equal(response.status, 303);
    assert.equal(response.headers.location, '/knigi/duna', `открытый редирект на ${evil}`);
  }
});
