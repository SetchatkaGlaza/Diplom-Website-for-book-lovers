'use strict';

/**
 * Тесты деплоя: то, что нельзя проверить глазами в песочнице.
 *
 * Здесь нет настоящего домена и HTTPS, поэтому проверяем то, что от нас
 * зависит: приложение отказывается стартовать с дырявым окружением, редиректы
 * ведут на канонический адрес, письма уходят через тот транспорт, который
 * настроен, а конфиг хостинга запускает именно наш сервер.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { inspectEnv, publicUrl } = require('../../src/config/env');
const { httpsRedirect } = require('../../src/lib/https');
const { buildTransport, assertMailReady } = require('../../src/lib/mailer');

const BASE_PROD = {
  NODE_ENV: 'production',
  SESSION_SECRET: 'x'.repeat(48),
  DATABASE_URL: 'postgres://user:pass@db.example.com:5432/knigomany',
  PUBLIC_URL: 'https://knigomany.ru',
  MAIL_FROM: 'Книгоманы <noreply@knigomany.ru>',
  RESEND_API_KEY: 're_test'
};

function withEnv(overrides = {}) {
  return { ...BASE_PROD, ...overrides };
}

/** Минимальная заглушка ответа: нам нужны только redirect и заголовки. */
function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    redirect(status, location) {
      this.statusCode = status;
      this.location = location;
      return this;
    }
  };
}

function fakeReq({ method = 'GET', url = '/', host = 'knigomany.ru', proto = 'https' } = {}) {
  const headers = { host };
  if (proto) headers['x-forwarded-proto'] = proto;
  return {
    method,
    originalUrl: url,
    path: url.split('?')[0],
    protocol: 'http',
    get(name) { return headers[name.toLowerCase()]; }
  };
}

test('продакшен: хорошее окружение проходит без ошибок', () => {
  const { errors } = inspectEnv(withEnv());
  assert.deepEqual(errors, []);
});

test('продакшен: без SESSION_SECRET, DATABASE_URL и PUBLIC_URL старт запрещён', () => {
  const { errors } = inspectEnv({
    NODE_ENV: 'production',
    PUBLIC_URL: undefined,
    SESSION_SECRET: undefined,
    DATABASE_URL: undefined
  });

  const text = errors.join('\n');
  assert.match(text, /SESSION_SECRET/);
  assert.match(text, /DATABASE_URL/);
  assert.match(text, /PUBLIC_URL/);
});

test('продакшен: короткий секрет и секрет из разработки — ошибка', () => {
  assert.match(inspectEnv(withEnv({ SESSION_SECRET: 'short' })).errors.join(' '), /короче 32/);
  assert.match(
    inspectEnv(withEnv({ SESSION_SECRET: 'dev-only-session-secret-change-me' })).errors.join(' '),
    /оставлен от разработки/
  );
});

test('продакшен: PUBLIC_URL без https и PGlite в памяти — ошибка', () => {
  assert.match(inspectEnv(withEnv({ PUBLIC_URL: 'http://knigomany.ru' })).errors.join(' '), /https/);
  assert.match(inspectEnv(withEnv({ DB_DRIVER: 'pglite' })).errors.join(' '), /в памяти/);
});

test('продакшен: без почтового транспорта — предупреждение, а не отказ', () => {
  const { errors, warnings } = inspectEnv(withEnv({ RESEND_API_KEY: undefined }));
  assert.deepEqual(errors, []);
  assert.match(warnings.join(' '), /письма/);

  const logged = [];
  const ready = assertMailReady({
    env: withEnv({ RESEND_API_KEY: undefined }),
    logger: { error: (...args) => logged.push(args.join(' ')) }
  });
  assert.equal(ready, false);
  assert.match(logged.join(' '), /транспорт/);
});

test('разработка: пустое окружение не мешает запуску, но предупреждает', () => {
  const { errors, warnings } = inspectEnv({ NODE_ENV: 'development' });
  assert.deepEqual(errors, []);
  assert.match(warnings.join(' '), /SESSION_SECRET/);
});

test('publicUrl убирает слэш на конце и берёт PUBLIC_URL', () => {
  assert.equal(publicUrl({ PUBLIC_URL: 'https://knigomany.ru/' }), 'https://knigomany.ru');
  assert.equal(publicUrl({ PORT: '4000' }), 'http://localhost:4000');
});

test('http и www переадресуются на канонический адрес одним редиректом', () => {
  const redirect = httpsRedirect({ enabled: true, env: withEnv() });

  const cases = [
    { req: fakeReq({ proto: 'http' }), url: 'https://knigomany.ru/' },
    { req: fakeReq({ host: 'www.knigomany.ru' }), url: 'https://knigomany.ru/' },
    { req: fakeReq({ host: 'knigomany.up.railway.app' }), url: 'https://knigomany.ru/' }
  ];

  cases.forEach(({ req, url }) => {
    const res = fakeRes();
    let called = false;
    redirect(req, res, () => { called = true; });

    assert.equal(called, false, 'должен быть редирект');
    assert.equal(res.statusCode, 308);
    assert.equal(res.location, url);
  });

  const res = fakeRes();
  redirect(fakeReq({ url: '/knigi/duna?x=1', proto: 'http' }), res, () => {});
  assert.equal(res.location, 'https://knigomany.ru/knigi/duna?x=1', 'путь и query сохраняются');
});

test('канонический адрес и healthz не редиректятся', () => {
  const redirect = httpsRedirect({ enabled: true, env: withEnv() });

  [{ url: '/' }, { url: '/healthz', host: 'internal.railway.app', proto: 'http' }].forEach(({ url, ...rest }) => {
    const res = fakeRes();
    let called = false;
    redirect(fakeReq({ url, ...rest }), res, () => { called = true; });
    assert.equal(called, true, `${url} не должен редиректиться`);
    assert.equal(res.statusCode, 200);
  });
});

test('в разработке редиректов нет: localhost остаётся как есть', () => {
  const passthrough = httpsRedirect({ enabled: false });
  let called = false;
  passthrough(fakeReq({ host: 'localhost:3000', proto: 'http' }), fakeRes(), () => { called = true; });
  assert.equal(called, true);
});

test('транспорт писем выбирается по окружению', () => {
  assert.equal(buildTransport({}).kind, 'console');
  assert.equal(buildTransport({ RESEND_API_KEY: 're_1' }).kind, 'resend');
  assert.equal(buildTransport({ SMTP_HOST: 'smtp.example.com' }).kind, 'smtp');
});

test('письмо через Resend уходит на нужный адрес и с ключом', async (t) => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, text: async () => '' };
  };
  t.after(() => { global.fetch = originalFetch; });

  const transport = buildTransport({ RESEND_API_KEY: 're_key', MAIL_FROM: 'Книгоманы <noreply@knigomany.ru>' });
  await transport.send({ to: 'reader@example.com', subject: 'Тест', text: 'Привет', html: '<p>Привет</p>' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer re_key');

  const body = JSON.parse(calls[0].options.body);
  assert.deepEqual(body.to, ['reader@example.com']);
  assert.equal(body.subject, 'Тест');
});

test('ошибка Resend не проглатывается: видно текст ответа', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 422, text: async () => 'invalid from' });
  t.after(() => { global.fetch = originalFetch; });

  const transport = buildTransport({ RESEND_API_KEY: 're_key' });
  await assert.rejects(
    () => transport.send({ to: 'a@b.c', subject: 's', text: 't', html: 'h' }),
    /Resend 422: invalid from/
  );
});

test('конфиг Railway запускает наш сервер и миграции, а не старый app.js', () => {
  const raw = fs.readFileSync(path.join(__dirname, '../../railway.json'), 'utf8');
  const config = JSON.parse(raw);

  assert.match(config.deploy.startCommand, /node src\/server\.js/);
  assert.match(config.deploy.startCommand, /db:migrate/);
  assert.equal(config.deploy.healthcheckPath, '/healthz');
  assert.ok(!raw.includes("'node app.js'"), 'старая точка входа не должна запускаться');
});

test('мёртвый код прошлой версии удалён из репозитория', () => {
  const root = path.join(__dirname, '../..');
  ['app.js', 'controllers', 'routes', 'models', 'views', 'middlewares', 'config', 'services', 'utils']
    .forEach((name) => {
      assert.equal(fs.existsSync(path.join(root, name)), false, `${name} не должен лежать в корне`);
    });
  assert.equal(fs.existsSync(path.join(root, 'src/app.js')), true);
});
