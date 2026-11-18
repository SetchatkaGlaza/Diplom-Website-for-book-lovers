'use strict';

require('./env');

const { Sequelize } = require('sequelize');
const { createDriver } = require('./pglite-driver');
const { defineModels } = require('../../src/models');

/**
 * Тестовая база: настоящий Postgres (PGlite, WASM) в памяти процесса.
 * Свой инстанс на каждый тестовый файл: тесты не мешают друг другу.
 */
async function createTestDatabase() {
  const dialectModule = await createDriver();
  const sequelize = new Sequelize('postgres://test:test@localhost:5432/test', {
    dialect: 'postgres',
    dialectModule,
    logging: false,
    pool: { max: 1, min: 0, acquire: 30000, idle: 10000 },
    define: { underscored: true, freezeTableName: false }
  });

  await sequelize.authenticate();
  const models = defineModels(sequelize);

  /**
   * Транзакции в тестах отключены.
   *
   * PGlite — одно соединение, а Sequelize внутри транзакции захватывает
   * второе из пула, и запрос зависает. Поэтому колбэк вызывается сразу,
   * а вместо транзакции передаётся undefined: Sequelize трактует это как
   * «без транзакции». Изоляцию обеспечивает reset() перед каждым тестом.
   */
  sequelize.transaction = async (optionsOrCallback, maybeCallback) => {
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
    if (typeof callback !== 'function') return undefined;
    return callback(undefined);
  };

  return {
    sequelize,
    models,
    async reset() {
      await sequelize.sync({ force: true });
    },
    async close() {
      await sequelize.close();
    }
  };
}

module.exports = { createTestDatabase };
