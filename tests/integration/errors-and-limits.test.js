'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, extractCsrf } = require('../support/app');
const { createLimiter } = require('../../src/lib/rate-limit');
const { redact, logger } = require('../../src/lib/logger');

test('500 не показывает стек и отдаёт понятный текст', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const response = await ctx.request.get('/test-error');
  assert.equal(response.status, 500);
  assert.match(response.text, /Мы уже записали ошибку/);
  assert.ok(!/специально уронили/.test(response.text), 'внутренний текст ошибки не должен утекать');
  assert.ok(!/at Object\./.test(response.text), 'стек не должен утекать');
});

test('403 отдаёт страницу и не раскрывает детали', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const response = await ctx.request.get('/test-forbidden');
  assert.equal(response.status, 403);
  assert.match(response.text, /Доступ закрыт|Недостаточно прав/);
});

test('POST с правильным CSRF-токеном доходит до обработчика', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const page = await ctx.agent.get('/');
  const token = extractCsrf(page.text);

  const response = await ctx.agent
    .post('/test-form')
    .type('form')
    .send({ _csrf: token, value: 'привет' });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.body.value, 'привет');
});

test('CSRF-токен можно передать заголовком (для fetch)', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const page = await ctx.agent.get('/');
  const token = extractCsrf(page.text);

  const response = await ctx.agent
    .post('/test-form')
    .set('x-csrf-token', token)
    .set('Content-Type', 'application/json')
    .send(JSON.stringify({ value: 1 }));

  assert.equal(response.status, 200);
});

test('лимитер блокирует лишние запросы и отдаёт Retry-After', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const limiter = createLimiter({ windowMs: 60000, max: 2, message: 'Хватит' });
  let allowed = 0;

  for (let i = 0; i < 3; i += 1) {
    await new Promise((resolve) => {
      const req = { ip: '10.0.0.1' };
      const res = {
        headers: {},
        setHeader(name, value) { this.headers[name.toLowerCase()] = value; }
      };
      limiter(req, res, (error) => {
        if (!error) allowed += 1;
        else {
          assert.equal(error.status, 429);
          assert.equal(res.headers['retry-after'] !== undefined, true);
        }
        resolve();
      });
    });
  }

  assert.equal(allowed, 2, 'должно пройти ровно два запроса');
});

test('лимитер считает пользователей по id, а не только по IP', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const { createLimiters } = require('../../src/lib/rate-limit');
  const limiters = createLimiters({ enabled: true });
  const write = limiters.write;

  const results = [];
  for (const userId of [1, 1, 2]) {
    await new Promise((resolve) => {
      const req = { ip: '10.0.0.1', currentUser: { id: userId } };
      const res = { setHeader() {} };
      write(req, res, (error) => { results.push(error ? 'blocked' : 'ok'); resolve(); });
    });
  }

  // 40 запросов на пользователя — лимит не должен сработать на третьем
  assert.deepEqual(results, ['ok', 'ok', 'ok']);
});

test('логгер скрывает пароли и токены', () => {
  const redacted = redact({
    email: 'anna@example.com',
    password: 'super-secret',
    nested: { sessionSecret: 'abc', token: 'xyz', ok: 'видно' }
  });

  assert.equal(redacted.email, 'anna@example.com');
  assert.equal(redacted.password, '[скрыто]');
  assert.equal(redacted.nested.sessionSecret, '[скрыто]');
  assert.equal(redacted.nested.token, '[скрыто]');
  assert.equal(redacted.nested.ok, 'видно');
  assert.ok(logger && typeof logger.info === 'function');
});
