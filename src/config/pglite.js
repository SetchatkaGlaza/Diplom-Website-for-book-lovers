'use strict';

const path = require('path');
const { Sequelize } = require('sequelize');

/**
 * Локальный Postgres без установки сервера: PGlite (WASM) + драйвер для Sequelize.
 * Нужен, чтобы `DB_DRIVER=pglite npm run dev` работал на чистой машине.
 * Данные по умолчанию живут в памяти и исчезают при остановке.
 */
async function createPgliteSequelize({ dataDir = null, logging = false } = {}) {
  const { createDriver } = require('../../tests/support/pglite-driver');
  const dialectModule = await createDriver(dataDir ? { dataDir } : {});

  const sequelize = new Sequelize('postgres://local:local@localhost:5432/knigomany', {
    dialect: 'postgres',
    dialectModule,
    logging,
    define: { underscored: true, freezeTableName: false },
    pool: { max: 1, min: 0, acquire: 30000, idle: 10000 }
  });

  await sequelize.authenticate();
  return sequelize;
}

module.exports = { createPgliteSequelize, ROOT: path.resolve(__dirname, '..', '..') };
