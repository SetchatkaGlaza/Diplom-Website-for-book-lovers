'use strict';

require('dotenv').config({ quiet: true });

const path = require('node:path');
const { createApp } = require('./app');
const { logger } = require('./lib/logger');
const { createPostgresSession, createMemorySession } = require('./lib/session');
const { assertEnv, isProduction } = require('./config/env');
const { assertMailReady } = require('./lib/mailer');
const dbDriver = require('./config/db-driver');

// Сначала окружение: без SESSION_SECRET и DATABASE_URL в продакшене
// приложение стартовать не должно, и узнать об этом лучше сразу
assertEnv();

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

/**
 * Подключение к БД.
 *
 * Какую базу брать — решает src/config/db-driver.js: если Postgres не
 * установлен и DB_DRIVER не задан явно, поднимается встроенная база (PGlite)
 * и проект запускается «из коробки». Схема накатывается миграциями, данные
 * заливаются сидом; DB_SEED=false отключает наполнение.
 */
async function connectDatabase() {
  const { Sequelize } = require('sequelize');
  const { defineModels } = require('./models');
  const { migrateUp } = require('./db/migrator');
  const MIGRATIONS = path.join(__dirname, 'db', 'migrations');

  const choice = await dbDriver.resolveDriver();
  dbDriver.announce(choice);

  if (choice.driver === 'pglite') {
    const { createPgliteSequelize } = require('./config/pglite');
    // База всегда лежит в папке (по умолчанию .data) и переживает
    // перезапуск: иначе «поставил книгу на полку, перезапустил — пусто».
    const dataDir = dbDriver.dataDir();
    const sequelize = await createPgliteSequelize({
      dataDir,
      logging: process.env.DB_LOGGING === 'true'
    });
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

    return { sequelize, models, isPglite: true };
  }

  const index = require('./models');
  try {
    await index.sequelize.authenticate();
  } catch (error) {
    // Явно выбранный Postgres не отвечает: подменять базу молча нельзя,
    // но и стектрейс на три экрана человеку не нужен — пишем, что делать.
    const hint = dbDriver.errorHint(error);
    logger.error('PostgreSQL недоступен', { hint, error: error.message });
    logger.error('Варианты: запустить Postgres, создать базу '
      + `«${process.env.DB_NAME || 'knigomany'}», указать DATABASE_URL `
      + 'или запустить со встроенной базой: DB_DRIVER=pglite npm run dev');
    throw error;
  }
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
