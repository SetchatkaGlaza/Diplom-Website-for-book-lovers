'use strict';

const path = require('path');
const { Sequelize } = require('sequelize');

const logging = process.env.DB_LOGGING === 'true' ? console.log : false;

const commonOptions = {
  dialect: 'postgres',
  logging,
  pool: { max: 8, min: 0, acquire: 30000, idle: 10000 },
  define: {
    underscored: true,
    freezeTableName: false
  }
};

/**
 * Единственная точка создания Sequelize.
 * В тестах используется PGlite (Postgres в памяти) через подмену драйвера,
 * поэ��ому код приложения о БД ничего не знает.
 */
function createSequelize(options = {}) {
  const databaseUrl = options.databaseUrl || process.env.DATABASE_URL || process.env.DB_URL;

  if (typeof options.dialectModule === 'function') {
    return new Sequelize(options.databaseUrl || 'postgres://postgres:postgres@localhost:5432/postgres', {
      ...commonOptions,
      pool: { max: 1, min: 0, acquire: 30000, idle: 10000 },
      dialectOptions: {},
      dialectModule: options.dialectModule,
      logging: options.logging === undefined ? logging : options.logging
    });
  }

  if (databaseUrl) {
    return new Sequelize(databaseUrl, {
      ...commonOptions,
      logging: options.logging === undefined ? logging : options.logging,
      dialectOptions: process.env.DB_SSL === 'false'
        ? {}
        : { ssl: { require: true, rejectUnauthorized: false } }
    });
  }

  return new Sequelize(
    process.env.DB_NAME || 'knigomany',
    process.env.DB_USER || 'postgres',
    process.env.DB_PASSWORD || 'postgres',
    {
      ...commonOptions,
      logging: options.logging === undefined ? logging : options.logging,
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT) || 5432
    }
  );
}

const sequelize = createSequelize();

module.exports = {
  sequelize,
  createSequelize,
  ROOT: path.resolve(__dirname, '..', '..')
};
