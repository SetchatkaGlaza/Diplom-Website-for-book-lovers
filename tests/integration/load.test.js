'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp } = require('../support/app');

/**
 * Нагрузочная проверка: главная и каталог держат 50 одновременных запросов.
 *
 * Это не бенчмарк ради цифр, а защита от регрессий: если появится N+1 или
 * запрос без индекса, время на 50 параллельных запросов заметно вырастет.
 * Порог сознательно мягкий — тест должен ловить порядок величины, а не
 * колебания скорости в песочнице.
 */

const CONCURRENCY = 50;
const MAX_TOTAL_MS = 20000;

async function hammer(ctx, path, count = CONCURRENCY) {
  const started = Date.now();
  const responses = await Promise.all(
    Array.from({ length: count }, () => ctx.request.get(path))
  );
  return {
    statuses: responses.map((response) => response.status),
    durationMs: Date.now() - started,
    sizes: responses.map((response) => response.text.length)
  };
}

function report(path, result) {
  const ok = result.statuses.filter((status) => status === 200).length;
  return `${path}: ${ok}/${CONCURRENCY} ответов 200 за ${result.durationMs} мс`;
}

test('главная и каталог держат 50 одновременных запросов', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  // Немного данных, чтобы запросы не были пустыми
  const genre = await ctx.models.Genre.create({ slug: 'fantastika', name: 'Фантастика' });
  for (let i = 1; i <= 20; i += 1) {
    const book = await ctx.models.Book.create({
      slug: `kniga-${i}`,
      title: `Книга ${i}`,
      author: 'Автор Тестов',
      pages: 300,
      isPublished: true
    });
    await book.addGenre(genre);
  }

  const home = await ctx.request.get('/');
  assert.equal(home.status, 200, 'разогреваем шаблоны до замера');

  for (const path of ['/', '/knigi']) {
    const result = await hammer(ctx, path);
    t.diagnostic(report(path, result));

    assert.equal(
      result.statuses.filter((status) => status === 200).length,
      CONCURRENCY,
      `${path}: не все запросы прошли (${result.statuses.slice(0, 5).join(', ')})`
    );
    assert.ok(result.durationMs < MAX_TOTAL_MS, `${path}: ${result.durationMs} мс на 50 запросов — слишком медленно`);
    assert.ok(result.sizes.every((size) => size > 500), `${path}: пришли пустые страницы`);
  }
});

test('страница книги под нагрузкой не делает запрос на каждую рецензию', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const book = await ctx.models.Book.create({
    slug: 'duna', title: 'Дюна', author: 'Герберт', pages: 600, isPublished: true
  });

  // 20 рецензий от разных людей: если появится N+1, число запросов вырастет втрое
  for (let i = 0; i < 20; i += 1) {
    const user = await ctx.createUser({ email: `reader${i}@example.com`, name: `Читатель ${i}` });
    await ctx.models.Review.create({
      userId: user.id, bookId: book.id, rating: 8,
      body: `Рецензия номер ${i}: достаточно длинный текст, чтобы пройти валидацию.`
    });
    await ctx.models.Quote.create({ userId: user.id, bookId: book.id, body: `Цитата номер ${i}` });
  }

  const sequelize = ctx.db.sequelize;
  const originalQuery = sequelize.query.bind(sequelize);
  let queries = 0;
  sequelize.query = (...args) => {
    queries += 1;
    return originalQuery(...args);
  };

  let response;
  try {
    queries = 0;
    response = await ctx.request.get('/knigi/duna');
  } finally {
    sequelize.query = originalQuery;
  }

  assert.equal(response.status, 200);
  assert.match(response.text, /Рецензия номер 19/);
  assert.ok(queries < 40, `карточка книги сделала ${queries} запросов при 20 рецензиях — похоже на N+1`);
  t.diagnostic(`карточка книги: ${queries} запросов на 20 рецензий`);
});

test('пятьдесят лент подряд не утекают по памяти и отвечают 200', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const { default: request } = { default: require('supertest') };
  const user = await ctx.createUser({ email: 'anna@example.com', name: 'Анна' });
  const agent = request.agent(ctx.app);
  await ctx.login(user, 'reader2026', agent);

  // Разогрев
  const warm = await agent.get('/lenta');
  assert.equal(warm.status, 200);

  const statuses = [];
  for (let i = 0; i < 10; i += 1) {
    const page = await agent.get('/lenta');
    statuses.push(page.status);
  }

  assert.ok(statuses.every((status) => status === 200), `не все запросы прошли: ${statuses.join(', ')}`);
});
