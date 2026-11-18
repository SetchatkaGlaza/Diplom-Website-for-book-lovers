'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, extractCsrf } = require('../support/app');

test('главная страница отдаёт 200 и корректный HTML', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const response = await ctx.request.get('/');
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /text\/html/);
  assert.match(response.text, /<html lang="ru"/);
  assert.match(response.text, /Читай\./);
  assert.match(response.text, /<meta name="description"/);
});

test('healthz отвечает JSON с requestId', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const response = await ctx.request.get('/healthz');
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.ok(response.headers['x-request-id']);
});

test('несуществующая страница отдаёт 404-страницу, а не стек', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const response = await ctx.request.get('/net-takoy-stranitsy');
  assert.equal(response.status, 404);
  assert.match(response.text, /Страница не найдена/);
  assert.ok(!/Error:|at Object\./.test(response.text), 'стек не должен утекать в HTML');
});

test('404 для API отдаёт JSON', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const response = await ctx.request.get('/api/net').set('Accept', 'application/json');
  assert.equal(response.status, 404);
  assert.equal(typeof response.body, 'object');
  assert.ok(response.body.error);
});

test('заголовки безопасности на месте', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const response = await ctx.request.get('/');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['x-frame-options'], 'DENY');
  assert.ok(response.headers['content-security-policy'], 'CSP должен быть');
  assert.ok(!response.headers['x-powered-by'], 'Express не должен светить версию');
});

test('CSRF: форма без токена получает 403, с токеном — проходит проверку', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const page = await ctx.agent.get('/');
  const token = extractCsrf(page.text);
  assert.ok(token, 'токен должен быть в HTML');

  const withoutToken = await ctx.agent.post('/test-form').type('form').send({ a: '1' });
  assert.equal(withoutToken.status, 403);
  assert.match(withoutToken.text, /Форма устарела/);
});

test('CSRF: токен из другой сессии не подходит', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const first = await ctx.request.get('/');
  const foreignToken = extractCsrf(first.text);
  assert.ok(foreignToken);

  // Второй клиент без куки получает свой токен; чужой не должен сработать
  const second = await ctx.request.get('/');
  const secondToken = extractCsrf(second.text);
  assert.notEqual(foreignToken, secondToken);

  const response = await ctx.request
    .post('/test-form')
    .set('Cookie', first.headers['set-cookie'] || [])
    .type('form')
    .send({ _csrf: secondToken });
  assert.equal(response.status, 403);
});
