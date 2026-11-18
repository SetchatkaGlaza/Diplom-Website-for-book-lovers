'use strict';

const session = require('express-session');

/**
 * Хранилища сессий.
 *
 * Прод — таблица в Postgres (connect-pg-simple): сессии переживают рестарт
 * и работают при нескольких процессах. Тесты — память: быстрее и без лишних
 * запросов между тестами.
 */

const COOKIE_NAME = 'km.sid';
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 дней

function sessionOptions({ isProduction = false } = {}) {
  if (isProduction && !process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET обязателен в production');
  }

  return {
    name: COOKIE_NAME,
    secret: process.env.SESSION_SECRET || 'dev-only-session-secret-change-me',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction,
      maxAge: MAX_AGE_MS
    }
  };
}

/** Продовое хранилище в Postgres. */
function createPostgresSession({ sequelize, isProduction = false }) {
  const connectPgSimple = require('connect-pg-simple');
  const PgStore = connectPgSimple(session);

  const store = new PgStore({
    pool: sequelize.connectionManager.pool,
    tableName: 'user_sessions',
    createTableIfMissing: true,
    pruneSessionInterval: 60 * 15,
    errorLog: (error) => console.error('[session]', error.message)
  });

  return session({ ...sessionOptions({ isProduction }), store });
}

/** Сессии в памяти — только для тестов и локальной отладки без БД. */
function createMemorySession({ isProduction = false } = {}) {
  return session({ ...sessionOptions({ isProduction }), store: new session.MemoryStore() });
}

module.exports = {
  COOKIE_NAME,
  MAX_AGE_MS,
  sessionOptions,
  createPostgresSession,
  createMemorySession
};
