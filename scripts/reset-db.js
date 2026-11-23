'use strict';

/**
 * «Начать с чистой базы»: `npm run db:reset`.
 *
 * Удаляет папку со встроенной базой, накатывает схему и заливает демо-данные.
 * Работает только для встроенной базы (PGlite): удалять чужой PostgreSQL
 * скрипт не имеет права.
 */

require('dotenv').config({ quiet: true });

const fs = require('node:fs');
const path = require('node:path');
const dbDriver = require('../src/config/db-driver');

async function main() {
  const choice = await dbDriver.resolveDriver();

  if (choice.driver !== 'pglite') {
    console.error('Сейчас используется PostgreSQL:', choice.reason);
    console.error('Скрипт удаляет только встроенную базу. Почистить PostgreSQL можно так:');
    console.error('  npm run db:rollback   — откатить миграции');
    process.exit(1);
  }

  const dir = dbDriver.dataDir();
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`Удалена папка базы: ${dir}`);
  } else {
    console.log(`Папки ${dir} нет — создам заново.`);
  }

  process.env.DB_DRIVER = 'pglite';
  process.env.PGLITE_DATA_DIR = dir;

  const { openDatabase } = require('../src/db/open');
  const db = await openDatabase({ migrate: true, silent: true });
  const { seed } = require('../src/db/seed');
  const result = await seed({ sequelize: db.sequelize, models: db.models, verbose: false });
  await db.close();

  const parts = [`${result.books} книг`, `${result.users} читателей`];
  if (result.clubs) parts.push(`${result.clubs} клубов`);
  if (result.collections) parts.push(`${result.collections} подборок`);
  console.log(`Готово: ${parts.join(', ')}.`);
  console.log('Запуск: npm run dev → http://localhost:3000');
  console.log('Вход: anna@example.com / reader2026');
  process.exit(0);
}

main().catch((error) => {
  console.error('Сброс базы не удался:', error.message);
  process.exit(1);
});
