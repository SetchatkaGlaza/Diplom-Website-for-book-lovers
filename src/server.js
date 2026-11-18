'use strict';

require('dotenv').config({ quiet: true });

const path = require('node:path');
const { createApp } = require('./app');
const { logger } = require('./lib/logger');
const { createPostgresSession, createMemorySession } = require('./lib/session');
const { assertEnv, isProduction } = require('./config/env');
const { assertMailReady } = require('./lib/mailer');

// Сначала окружение: без SESSION_SECRET и DATABASE_URL в продакшене
// приложение стартовать не должно, и узнать об этом лучше сразу
assertEnv();

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

/**
 * Подключение к БД.
 *
 * DB_DRIVER=pglite — локальная разработка без установки Postgres: база
 * поднимается в памяти процесса, схема накатывается миграциями, данные
 * заливаются сидом. DB_SEED=false отключает наполнение.
 * Иначе — настоящий Postgres по DATABASE_URL / DB_*.
 */
async function connectDatabase() {
  const { Sequelize } = require('sequelize');
  const { defineModels } = require('./models');
  const { migrateUp } = require('./db/migrator');
  const MIGRATIONS = path.join(__dirname, 'db', 'migrations');

  if (process.env.DB_DRIVER === 'pglite') {
    const { createPgliteSequelize } = require('./config/pglite');
    const sequelize = await createPgliteSequelize({ logging: process.env.DB_LOGGING === 'true' });
    const models = defineModels(sequelize);

    if (process.env.DB_RESET === 'true') {
      await sequelize.sync({ force: true });
      logger.warn('схема пересоздана (DB_RESET=true)');
    }
    await migrateUp(sequelize, Sequelize, { dir: MIGRATIONS, useTransactions: false });

    if (process.env.DB_SEED !== 'false') {
      const { seed } = require('./db/seed');
      const result = await seed({ sequelize, models, verbose: false });
      logger.info('демо-данные загружены', { books: result.books, genres: result.genres, users: result.users });
    }

    logger.warn('режим разработки: БД в памяти (PGlite), данные не сохраняются после остановки');
    return { sequelize, models, isPglite: true };
  }

  const index = require('./models');
  await index.sequelize.authenticate();
  // Письма: в продакшене проверяем транспорт до первого письма, а не после
  if (!assertMailReady({ logger })) {
    logger.warn('регистрация и сброс пароля будут работать только частично');
  }
  logger.info('подключение к БД установлено');

  if (process.env.DB_MIGRATE === 'true') {
    await migrateUp(index.sequelize, Sequelize, { dir: MIGRATIONS });
    logger.info('миграции применены');
  }

  return { sequelize: index.sequelize, models: index, isPglite: false };
}

async function start() {
  try {
    const { sequelize, models, isPglite } = await connectDatabase();

    const app = createApp({
      models,
      sessionMiddleware: isPglite
        ? createMemorySession()
        : createPostgresSession({
          sequelize,
          isProduction: isProduction()
        })
    });

    const server = app.listen(PORT, HOST, () => {
      logger.info('сервер запущен', { url: `http://${HOST}:${PORT}` });
    });

    const shutdown = async (signal) => {
      logger.info('остановка сервера', { signal });
      server.close(async () => {
        await sequelize.close();
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10000).unref();
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.error('не удалось запустить приложение', { error: error.message, stack: error.stack });
    process.exitCode = 1;
  }
}

start();
