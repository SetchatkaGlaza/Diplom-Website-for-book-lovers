'use strict';

require('dotenv').config({ quiet: true });

const { Sequelize } = require('sequelize');
const { migrateUp, migrateDown, migrationStatus } = require('./migrator');
const { openDatabase, MIGRATIONS } = require('./open');

/**
 * Миграции из консоли.
 *
 *   npm run db:migrate          — накатить все
 *   npm run db:rollback         — откатить последнюю
 *   npm run db:status           — что применено
 *
 * База выбирается так же, как у сайта: Postgres, если он есть, иначе
 * встроенная (PGlite). Поэтому команда работает на чистой машине.
 */
async function main() {
  const command = process.argv[2] || 'status';
  const steps = Number(process.argv[3]) || 1;
  const db = await openDatabase();

  try {
    if (command === 'up') {
      const done = await migrateUp(db.sequelize, Sequelize, {
        dir: MIGRATIONS,
        useTransactions: db.driver !== 'pglite'
      });
      console.log(done.length ? `Применено миграций: ${done.length}\n${done.join('\n')}` : 'Новых миграций нет');
    } else if (command === 'down') {
      const done = await migrateDown(db.sequelize, Sequelize, {
        dir: MIGRATIONS,
        steps,
        useTransactions: db.driver !== 'pglite'
      });
      console.log(done.length ? `Откачено: ${done.join(', ')}` : 'Нечего откатывать');
    } else {
      const status = await migrationStatus(db.sequelize, Sequelize, { dir: MIGRATIONS });
      status.forEach((item) => console.log(`${item.applied ? '[x]' : '[ ]'} ${item.name}`));
    }
  } catch (error) {
    console.error('Ошибка миграций:', error.message);
    process.exitCode = 1;
  } finally {
    await db.close();
    // Встроенная база держит воркер живым даже после close();
    // без явного выхода консольная команда «зависает» навсегда.
    process.exit(process.exitCode || 0);
  }
}

main();
