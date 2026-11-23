'use strict';

/**
 * Какую базу использовать.
 *
 * Проблема, которую решает файл: человек скачал проект, написал `npm run dev`
 * и получил трёхэкранный стектрейс «база данных "knigomany" не существует».
 * Postgres не установлен — и это нормально для диплома, проверки и первого
 * запуска. Поэтому правило простое:
 *
 *  1. `DB_DRIVER=pglite` — всегда встроенная база (PGlite), без вопросов.
 *  2. `DB_DRIVER=postgres` — всегда настоящий Postgres, даже если недоступен:
 *     в продакшене молча подменять базу нельзя, лучше упасть с понятным текстом.
 *  3. Ничего не задано — пробуем Postgres, а если он не отвечает за пару секунд,
 *     поднимаем встроенную и честно пишем об этом в журнал.
 *
 * Встроенная база — настоящий Postgres, собранный в WASM: те же миграции,
 * тот же SQL, но без установки сервера. Данные лежат в папке (по умолчанию
 * `.data`), поэтому переживают перезапуск.
 */

const path = require('node:path');
const { logger } = require('../lib/logger');

const DEFAULT_DATA_DIR = '.data';
const PROBE_TIMEOUT_MS = 2500;

/** Абсолютный путь к папке данных встроенной базы. */
function dataDir() {
  const raw = process.env.PGLITE_DATA_DIR && process.env.PGLITE_DATA_DIR.trim();
  return path.resolve(raw || DEFAULT_DATA_DIR);
}

/** Режим, выбранный явно через DB_DRIVER (или null, если не выбран). */
function requestedDriver() {
  const value = String(process.env.DB_DRIVER || '').trim().toLowerCase();
  if (value === 'pglite' || value === 'embedded') return 'pglite';
  if (value === 'postgres' || value === 'pg') return 'postgres';
  return null;
}

function errorHint(error) {
  const message = String((error && error.message) || error || '');
  // Коды Postgres: 3D000 — нет такой базы, ECONNREFUSED — сервер не запущен
  if (/3D000/.test(message) || /не существует/.test(message) || /does not exist/.test(message)) {
    return 'базы с таким именем нет — создайте её или запустите встроенную базу';
  }
  if (/ECONNREFUSED/.test(message)) return 'Postgres не запущен на указанном адресе';
  if (/28P01|password|пароль/i.test(message)) return 'неверный пароль пользователя базы';
  if (/ENOTFOUND|EAI_AGAIN/.test(message)) return 'хост базы не найден — проверьте DATABASE_URL';
  if (/timeout|ETIMEDOUT/i.test(message)) return 'сервер базы не ответил вовремя';
  return 'проверьте DATABASE_URL и доступность Postgres';
}

/**
 * Быстрая проверка, отвечает ли настоящий Postgres.
 *
 * Отдельный клиент с таймаутом, а не `sequelize.authenticate()`: последний
 * может висеть десятки секунд и печатать стектрейс. Нам нужно только
 * «да/нет» за пару секунд.
 */
async function probePostgres({ timeout = PROBE_TIMEOUT_MS } = {}) {
  const { Client } = require('pg');
  const connectionString = process.env.DATABASE_URL || process.env.DB_URL;
  const config = connectionString
    ? {
      connectionString,
      ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false }
    }
    : {
      database: process.env.DB_NAME || 'knigomany',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT) || 5432
    };

  const client = new Client({ ...config, connectionTimeoutMillis: timeout });
  try {
    await client.connect();
    await client.query('select 1');
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  } finally {
    // close() на неудавшемся соединении бросает — гасим, он уже не нужен
    client.end().catch(() => {});
  }
}

/**
 * Решает, что использовать. Возвращает `{ driver, reason, error }`.
 * driver: 'pglite' | 'postgres'.
 */
async function resolveDriver({ probe = probePostgres } = {}) {
  const explicit = requestedDriver();

  if (explicit === 'pglite') {
    return { driver: 'pglite', reason: 'задано DB_DRIVER=pglite' };
  }

  if (explicit === 'postgres') {
    return { driver: 'postgres', reason: 'задано DB_DRIVER=postgres' };
  }

  const check = await probe();
  if (check.ok) return { driver: 'postgres', reason: 'Postgres отвечает' };

  return {
    driver: 'pglite',
    reason: `Postgres недоступен (${errorHint(check.error)}) — включаю встроенную базу`,
    error: check.error
  };
}

/**
 * Печатает в журнал, что выбрано и почему. Один раз при старте —
 * чтобы человек не гадал, куда пишутся данные.
 */
function announce({ driver, reason }) {
  if (driver === 'pglite') {
    const dir = dataDir();
    logger.info('база: встроенная (PGlite)', { reason, dataDir: dir });
    logger.info(`данные лежат в ${dir} — удалите папку, чтобы начать с нуля`);
  } else {
    logger.info('база: PostgreSQL', { reason });
  }
}

module.exports = {
  dataDir,
  resolveDriver,
  probePostgres,
  announce,
  errorHint,
  requestedDriver,
  DEFAULT_DATA_DIR
};
