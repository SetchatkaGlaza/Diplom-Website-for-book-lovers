'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createTestApp, extractCsrf } = require('../support/app');

/**
 * Безопасность: XSS, подделка форм, перебор паролей, большие тела.
 *
 * Проверяем не «код написан правильно», а что видит браузер:
 *  - текст пользователя попадает в HTML только экранированным;
 *  - форма без CSRF-токена или с чужим токеном отклоняется;
 *  - перебор паролей упирается в лимит, а не в бесконечные попытки;
 *  - гигантское тело не роняет сервер.
 */

async function signIn(ctx, email, name) {
  const user = await ctx.createUser({ email, name });
  const agent = request.agent(ctx.app);
  await ctx.login(user, 'reader2026', agent);
  return { user, agent };
}

test('XSS в отзыве не превращается в тег', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signIn(ctx, 'anna@example.com', 'Анна');
  const book = await ctx.models.Book.create({
    slug: 'duna', title: 'Дюна', author: 'Герберт', pages: 600, isPublished: true
  });

  const payload = '<script>alert("xss")</script> и <img src=x onerror=alert(1)>';
  await ctx.models.Review.create({
    userId: anna.user.id, bookId: book.id, rating: 8, body: `${payload} — обычный текст рецензии.`
  });
  await ctx.models.Quote.create({
    userId: anna.user.id, bookId: book.id, body: '<b>цитата</b>'
  });

  const page = await anna.agent.get('/knigi/duna');
  assert.equal(page.status, 200);
  assert.ok(!page.text.includes('<script>alert'), 'скрипт не должен попасть в HTML');
  // Атрибут может остаться строкой внутри текста, но не как часть тега <img>
  assert.ok(!/<img[^>]*onerror/i.test(page.text), 'обработчик не должен стать атрибутом тега');
  assert.match(page.text, /&lt;script&gt;/);

  // Название книги с кавычками не ломает разметку
  const tricky = await ctx.models.Book.create({
    slug: 'tricky', title: 'Книга "в кавычках" & <тегах>', author: 'Автор', pages: 100, isPublished: true
  });
  const trickyPage = await ctx.request.get('/knigi/tricky');
  assert.equal(trickyPage.status, 200);
  assert.ok(!trickyPage.text.includes('<тегах>'));

  // JSON-LD остаётся валидным JSON даже с такими данными
  const blocks = [...trickyPage.text.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  for (const block of blocks) {
    assert.doesNotThrow(() => JSON.parse(block[1]), 'JSON-LD должен парситься');
  }
  void tricky;
});

test('CSRF: без токена и с чужим токеном — отказ', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signIn(ctx, 'anna@example.com', 'Анна');
  const boris = await signIn(ctx, 'boris@example.com', 'Борис');
  const book = await ctx.models.Book.create({
    slug: 'duna', title: 'Дюна', author: 'Герберт', pages: 600, isPublished: true
  });

  // Без токена
  const noToken = await anna.agent.post(`/polka/${book.slug}/status`).type('form')
    .send({ status: 'read' });
  assert.equal(noToken.status, 403);

  // Токен из чужой сессии
  const borisToken = await extractCsrf((await boris.agent.get('/polka')).text);
  const foreignToken = await anna.agent.post(`/polka/${book.slug}/status`).type('form')
    .send({ _csrf: borisToken, status: 'read' });
  assert.equal(foreignToken.status, 403, 'чужой токен не подходит');

  assert.equal(await ctx.models.LibraryEntry.count(), 0, 'ничего не записалось');

  // Свой токен работает
  const ownToken = await extractCsrf((await anna.agent.get('/polka')).text);
  const ok = await anna.agent.post(`/polka/${book.slug}/status`).type('form')
    .send({ _csrf: ownToken, status: 'read' });
  assert.equal(ok.status, 303);
  assert.equal(await ctx.models.LibraryEntry.count(), 1);
});

test('перебор паролей упирается в лимит', async (t) => {
  const ctx = await createTestApp({ limiterEnabled: true });
  t.after(() => ctx.close());

  const anna = await ctx.createUser({ email: 'anna@example.com', name: 'Анна' });
  void anna;

  const agent = request.agent(ctx.app);

  // Лимит входа — 20 попыток за 15 минут: доходим до 22 и ждём отказ
  const statuses = [];
  for (let i = 0; i < 22; i += 1) {
    const page = await agent.get('/vhod');
    const response = await agent.post('/vhod').type('form').send({
      _csrf: extractCsrf(page.text),
      email: 'anna@example.com',
      password: `wrongPass${i}`
    });
    statuses.push(response.status);
  }

  assert.ok(statuses.includes(429), `ожидали 429 среди ${statuses.join(', ')}`);
  assert.ok(statuses.filter((status) => status === 429).length >= 1);
});

test('гигантское тело запроса не роняет сервер', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signIn(ctx, 'anna@example.com', 'Анна');
  const token = await extractCsrf((await anna.agent.get('/polka')).text);

  const huge = await anna.agent.post('/nastroyki/profil').type('form')
    .send({ _csrf: token, name: 'Анна', bio: 'а'.repeat(300 * 1024) });

  assert.ok([413, 422, 400].includes(huge.status), `ожидали отказ, получили ${huge.status}`);

  // Сервер жив: следующий запрос работает
  const alive = await anna.agent.get('/polka');
  assert.equal(alive.status, 200);
});

test('подделка типа файла при импорте не проходит', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signIn(ctx, 'anna@example.com', 'Анна');
  const token = await extractCsrf((await anna.agent.get('/import')).text);

  // HTML вместо CSV — импорт не выполняется и ничего не пишет
  const response = await anna.agent.post('/import').type('form')
    .send({ _csrf: token, file: '<html><script>alert(1)</script></html>' });

  assert.ok([200, 422].includes(response.status));
  assert.equal(await ctx.models.LibraryEntry.count(), 0);
  assert.ok(!response.text.includes('<script>alert'), 'текст файла не попал в ответ как разметка');
});

test('заголовки безопасности на месте', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const response = await ctx.request.get('/');

  assert.match(String(response.headers['content-security-policy']), /default-src 'self'/);
  assert.match(String(response.headers['content-security-policy']), /frame-ancestors 'none'/);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['x-frame-options'], 'DENY');
  assert.match(String(response.headers['referrer-policy']), /strict-origin/);
  assert.ok(!response.headers['x-powered-by'], 'версию Express не показываем');
});

test('в ответах нет стека и служебных путей', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const broken = await ctx.request.get('/test-error');
  assert.equal(broken.status, 500);
  assert.ok(!broken.text.includes('at Object.'), 'стек не должен попадать в HTML');
  assert.ok(!broken.text.includes('/home/user/'), 'пути сервера не показываем');
  assert.match(broken.text, /ошибк/i);
});

test('скрытая рецензия не видна посторонним, но видна автору в форме', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signIn(ctx, 'anna@example.com', 'Анна');
  const page = await ctx.request.get('/');
  void page;

  const book = await ctx.models.Book.create({
    slug: 'duna', title: 'Дюна', author: 'Герберт', pages: 600, isPublished: true
  });
  await ctx.models.Review.create({
    userId: anna.user.id, bookId: book.id, rating: 8,
    body: 'Скрытая рецензия с текстом, который не должен попасть в общий доступ.',
    state: 'hidden'
  });

  const publicPage = await ctx.request.get('/knigi/duna');
  assert.ok(!publicPage.text.includes('Скрытая рецензия'), 'скрытая рецензия не показывается');

  const ownerPage = await anna.agent.get('/knigi/duna/retsenziya');
  assert.equal(ownerPage.status, 200, 'автор видит свою форму рецензии');
});
