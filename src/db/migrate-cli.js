'use strict';

require('dotenv').config({ quiet: true });

const path = require('path');
const { Sequelize } = require('sequelize');
const { migrateUp, migrateDown, migrationStatus } = require('./migrator');

const DIR = path.join(__dirname, 'migrations');

async function getSequelize() {
  if (process.env.DB_DRIVER === 'pglite') {
    const { createPgliteSequelize } = require('../config/pglite');
    return createPgliteSequelize({ dataDir: process.env.PGLITE_DATA_DIR || null });
  }
  const { sequelize } = require('../models');
  await sequelize.authenticate();
  return sequelize;
}

async function main() {
  const command = process.argv[2] || 'status';
  const steps = Number(process.argv[3]) || 1;
  const sequelize = await getSequelize();

  try {
    if (command === 'up') {
      const done = await migrateUp(sequelize, Sequelize, { dir: DIR });
      console.log(done.length ? `Применено миграций: ${done.length}\n${done.join('\n')}` : 'Новых миграций нет');
    } else if (command === 'down') {
      const done = await migrateDown(sequelize, Sequelize, { dir: DIR, steps });
      console.log(done.length ? `Откачено: ${done.join(', ')}` : 'Нечего откатывать');
    } else {
      const status = await migrationStatus(sequelize, Sequelize, { dir: DIR });
      status.forEach((item) => console.log(`${item.applied ? '[x]' : '[ ]'} ${item.name}`));
    }
  } catch (error) {
    console.error('Ошибка миграций:', error.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
    if (process.env.DB_DRIVER !== 'pglite') process.exit(process.exitCode || 0);
  }
}

main();
