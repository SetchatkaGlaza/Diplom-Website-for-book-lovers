'use strict';

require('./env');

const request = require('supertest');
const bcrypt = require('bcrypt');
const { createTestDatabase } = require('./db');
const { createApp } = require('../../src/app');
const { createMemorySession } = require('../../src/lib/session');
const { createLimiters } = require('../../src/lib/rate-limit');

/**
 * Полноценное приложение для интеграционных тестов:
 * настоящие маршруты, настоящие шаблоны, настоящая БД (PGlite), сессии в памяти.
 * Лимиты по умолчанию выключены, чтобы тесты не упирались в 429.
 */
/**
 * Одна база PGlite на файл тестов.
 *
 * Каждый вызов createTestApp раньше создавал новый экземпляр Postgres в WASM:
 * это ~2 секунды и много памяти, из-за чего файл с десятком тестов
 * останавливался по памяти. Теперь база одна, а между тестами очищаются данные.
 */
let sharedDb = null;

async function getSharedDatabase() {
  if (!sharedDb) {
    sharedDb = await createTestDatabase();
    await sharedDb.reset();
  }
  return sharedDb;
}

async function resetData(sequelize) {
  const tables = await sequelize.getQueryInterface().showAllTables();
  const list = tables.filter((table) => table !== 'migrations');
  if (!list.length) return;
  await sequelize.query(`TRUNCATE TABLE ${list.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

async function createTestApp({ limiterEnabled = false } = {}) {
  const db = await getSharedDatabase();
  await resetData(db.sequelize);

  const app = createApp({
    models: { ...db.models },
    sessionMiddleware: createMemorySession(),
    limiters: createLimiters({ enabled: limiterEnabled }),
    extraRoutes(instance) {
      instance.post('/test-form', (req, res) => res.json({ ok: true, body: req.body }));
      instance.get('/test-error', () => {
        throw new Error('специально уронили для теста');
      });
      instance.get('/test-forbidden', (req, res, next) => {
        const error = new Error('Недостаточно прав');
        error.status = 403;
        next(error);
      });
    }
  });

  const agent = request.agent(app);

  const ctx = {
    app,
    db,
    models: db.models,
    // Часть проверок вызывает сервисы напрямую (например, чтобы залить 13 рецензий)
    services: app.locals.services,
    agent,
    request: request(app),

    async createUser(overrides = {}) {
      const passwordHash = await bcrypt.hash(overrides.password || 'reader2026', 4);
      const data = {
        email: `reader${Date.now()}${Math.random().toString(16).slice(2, 8)}@example.com`,
        name: 'Анна',
        passwordHash,
        role: 'user',
        ...overrides
      };
      if (data.emailVerified !== undefined) {
        data.emailVerifiedAt = data.emailVerified ? new Date() : null;
        delete data.emailVerified;
      } else {
        data.emailVerifiedAt = new Date();
      }
      return db.models.User.create(data);
    },

    /** Логин через HTTP: возвращает тот же агент с сессией. */
    async login(user, password = 'reader2026', agentToUse = agent) {
      const page = await agentToUse.get('/vhod');
      const token = extractCsrf(page.text);
      const response = await agentToUse
        .post('/vhod')
        .type('form')
        .send({ email: user.email, password, _csrf: token });
      return { agent: agentToUse, response };
    },

    /** Достаёт CSRF-токен со страницы (нужен перед каждым POST). */
    async csrf(path = '/') {
      const page = await agent.get(path);
      return extractCsrf(page.text);
    },

    /** База общая на файл, поэтому «закрытие» лишь очищает данные. */
    async close() {
      try {
        await resetData(db.sequelize);
      } catch (error) {
        // Если база уже недоступна — молча выходим: чистить нечего
      }
    }
  };

  return ctx;
}

/** Достаёт CSRF-токен из HTML (скрытое поле формы или meta-тег). */
function extractCsrf(html) {
  const field = /name="_csrf"\s+value="([a-f0-9]{64})"/.exec(html);
  if (field) return field[1];
  const meta = /name="csrf-token"\s+content="([a-f0-9]{64})"/.exec(html);
  return meta ? meta[1] : null;
}

module.exports = { createTestApp, extractCsrf };
