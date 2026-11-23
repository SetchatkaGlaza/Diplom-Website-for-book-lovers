'use strict';

/**
 * Единая точка подключения к базе для консольных команд
 * (миграции, сид, контент, дайджест).
 *
 * Зачем: в проекте четыре CLI, и каждый по-своему решал, брать PGlite или
 * Postgres. Из-за этого `npm run db:migrate` падал со стектрейсом, если
 * Postgres не установлен, хотя `npm run dev` работал. Теперь решение одно
 * и то же везде — его принимает src/config/db-driver.js.
 *
 *   const db = await openDatabase({ migrate: true });
 *   // db.models, db.sequelize, db.driver
 *   await db.close();
 */

const path = require('node:path');
const { Sequelize } = require('sequelize');
const { defineModels } = require('../models');
const { migrateUp } = require('./migrator');
const dbDriver = require('../config/db-driver');

const MIGRATIONS = path.join(__dirname, 'migrations');

/**
 * Открывает базу.
 *
 * migrate: true  — накатить миграции (для CLI: команды должны работать на
 *                  чистой папке, иначе «таблицы не существует»).
 */
async function openDatabase({ migrate = false, silent = false } = {}) {
  const choice = await dbDriver.resolveDriver();
  if (!silent) dbDriver.announce(choice);

  if (choice.driver === 'pglite') {
    const { createPgliteSequelize } = require('../config/pglite');
    const sequelize = await createPgliteSequelize({
      dataDir: dbDriver.dataDir(),
      logging: process.env.DB_LOGGING === 'true'
    });
    const models = defineModels(sequelize);

    if (migrate || process.env.DB_MIGRATE === 'true') {
      await migrateUp(sequelize, Sequelize, { dir: MIGRATIONS, useTransactions: false });
    }

    return {
      sequelize,
      models,
      driver: 'pglite',
      // PGlite закрывается всегда: иначе процесс не завершится
      close: async () => { await sequelize.close(); }
    };
  }

  const index = require('../models');
  try {
    await index.sequelize.authenticate();
  } catch (error) {
    const hint = dbDriver.errorHint(error);
    console.error(`\nНе удалось подключиться к PostgreSQL: ${hint}.`);
    console.error('Что можно сделать:');
    console.error('  · запустить Postgres и создать базу;');
    console.error('  · указать строку подключения в DATABASE_URL;');
    console.error('  · или работать без Postgres: DB_DRIVER=pglite npm run db:migrate\n');
    throw error;
  }

  const models = index;
  if (migrate || process.env.DB_MIGRATE === 'true') {
    await migrateUp(index.sequelize, Sequelize, { dir: MIGRATIONS });
  }

  return {
    sequelize: index.sequelize,
    models,
    driver: 'postgres',
    close: async () => { await index.sequelize.close(); }
  };
}

module.exports = { openDatabase, MIGRATIONS };
