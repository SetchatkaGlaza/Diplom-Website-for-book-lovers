'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Мини-миграции без sequelize-cli.
 *
 * Каждая миграция — файл `NNN-имя.js` с двумя функциями: up(queryInterface, Sequelize)
 * и down(queryInterface, Sequelize). Учёт — в таблице `migrations`
 * (имя файла + контрольная сумма), чтобы нельзя было незаметно переписать
 * уже применённую миграцию.
 */

const MIGRATIONS_TABLE = 'migrations';

function checksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function listMigrationFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => /^\d{3}-[a-z0-9-]+\.js$/.test(file))
    .sort();
}

async function ensureTable(queryInterface, Sequelize) {
  const tables = await queryInterface.showAllTables();
  const exists = tables.some((table) => {
    const name = typeof table === 'string' ? table : table.tableName;
    return name === MIGRATIONS_TABLE;
  });
  if (exists) return;

  await queryInterface.createTable(MIGRATIONS_TABLE, {
    name: { type: Sequelize.STRING(255), primaryKey: true },
    checksum: { type: Sequelize.STRING(64), allowNull: false },
    applied_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
  });
}

async function appliedMigrations(queryInterface) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT name, checksum FROM ${MIGRATIONS_TABLE} ORDER BY name`
  );
  return rows;
}

function loadMigration(dir, file) {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const migration = require(path.join(dir, file));
  if (typeof migration.up !== 'function' || typeof migration.down !== 'function') {
    throw new Error(`Миграция ${file}: нужны функции up() и down()`);
  }
  return migration;
}

/**
 * Накатить все неприменённые миграции.
 *
 * useTransactions: false нужен для тестов на PGlite (одно соединение,
 * транзакция внутри транзакции зависает). В проде всегда true.
 */
async function migrateUp(sequelize, Sequelize, { dir, useTransactions = true }) {
  const queryInterface = sequelize.getQueryInterface();
  await ensureTable(queryInterface, Sequelize);

  const applied = await appliedMigrations(queryInterface);
  const appliedMap = new Map(applied.map((row) => [row.name, row.checksum]));
  const files = listMigrationFiles(dir);
  const done = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(dir, file), 'utf8');
    const sum = checksum(content);

    if (appliedMap.has(file)) {
      if (appliedMap.get(file) !== sum) {
        throw new Error(`Миграция ${file} уже применена, но файл изменён. Создайте новую миграцию.`);
      }
      continue;
    }

    const migration = loadMigration(dir, file);
    const transaction = useTransactions ? await sequelize.transaction() : undefined;
    try {
      await migration.up(queryInterface, Sequelize, transaction);
      await queryInterface.sequelize.query(
        `INSERT INTO ${MIGRATIONS_TABLE} (name, checksum) VALUES (?, ?)`,
        { replacements: [file, sum], transaction }
      );
      if (transaction) await transaction.commit();
      done.push(file);
    } catch (error) {
      if (transaction) await transaction.rollback();
      throw new Error(`Миграция ${file} упала: ${error.message}`);
    }
  }

  return done;
}

/** Откатить последние N миграций. */
async function migrateDown(sequelize, Sequelize, { dir, steps = 1, useTransactions = true }) {
  const queryInterface = sequelize.getQueryInterface();
  await ensureTable(queryInterface, Sequelize);

  const applied = await appliedMigrations(queryInterface);
  const targets = applied.slice(-steps).reverse();
  const rolledBack = [];

  for (const row of targets) {
    const migration = loadMigration(dir, row.name);
    const transaction = useTransactions ? await sequelize.transaction() : undefined;
    try {
      await migration.down(queryInterface, Sequelize, transaction);
      await queryInterface.sequelize.query(
        `DELETE FROM ${MIGRATIONS_TABLE} WHERE name = ?`,
        { replacements: [row.name], transaction }
      );
      if (transaction) await transaction.commit();
      rolledBack.push(row.name);
    } catch (error) {
      if (transaction) await transaction.rollback();
      throw new Error(`Откат ${row.name} упал: ${error.message}`);
    }
  }

  return rolledBack;
}

async function migrationStatus(sequelize, Sequelize, { dir }) {
  const queryInterface = sequelize.getQueryInterface();
  await ensureTable(queryInterface, Sequelize);
  const applied = await appliedMigrations(queryInterface);
  const appliedNames = new Set(applied.map((row) => row.name));
  return listMigrationFiles(dir).map((file) => ({
    name: file,
    applied: appliedNames.has(file)
  }));
}

module.exports = { migrateUp, migrateDown, migrationStatus, MIGRATIONS_TABLE, listMigrationFiles };
