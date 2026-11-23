'use strict';

/**
 * Рассылка дайджеста из командной строки.
 *
 *   node src/db/digest-cli.js run               # недельное письмо всем, кому можно
 *   node src/db/digest-cli.js run --dry-run     # собрать письма, ничего не отправляя
 *   node src/db/digest-cli.js run --kind comeback
 *   node src/db/digest-cli.js stats             # что ушло за 30 дней
 *
 * Почему отдельная команда, а не таймер внутри приложения:
 * на проде может быть несколько инстансов приложения — два таймера
 * отправят два письма. Cron или Railway Scheduler запускает команду
 * один раз; повторный запуск безопасен (период записан в digests).
 *
 * Пример для cron (каждый понедельник в 10:00):
 *   0 10 * * 1 cd /app && node src/db/digest-cli.js run >> logs/digest.log 2>&1
 */

require('dotenv').config({ quiet: true });

const { createDigestService } = require('../services/digest');
const { sendDigestEmail, transportKind, assertMailReady } = require('../lib/mailer');
const { publicUrl } = require('../config/env');

/**
 * База выбирается так же, как у сайта (src/config/db-driver.js):
 * Postgres, если он есть, иначе встроенная.
 */
async function openDatabase() {
  const db = await require('./open').openDatabase({ migrate: true });
  return { ...db, owned: true };
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'run';
  const flag = (name) => args.includes(`--${name}`);

  const db = await openDatabase();
  try {
    const digest = createDigestService({
      User: db.models.User,
      LibraryEntry: db.models.LibraryEntry,
      Book: db.models.Book,
      Digest: db.models.Digest,
      EmailUnsubscribe: db.models.EmailUnsubscribe,
      ReadingGoal: db.models.ReadingGoal,
      sequelize: db.sequelize,
      send: sendDigestEmail,
      baseUrl: publicUrl
    });

    if (command === 'stats') {
      const stats = await digest.stats({ days: 30 });
      console.log(`[рассылка] за ${stats.days} дней: отправлено ${stats.sent}, `
        + `ошибок ${stats.failed}, пропущено ${stats.skipped}, отписались ${stats.unsubscribed}`);
      return;
    }

    if (command === 'recipients') {
      const list = await digest.recipients({ kind: 'weekly', limit: 1000 });
      console.log(`[рассылка] можно написать: ${list.length}`);
      list.slice(0, 20).forEach((user) => console.log(`  - ${user.name} <${user.email}>`));
      return;
    }

    if (command !== 'run') {
      console.error(`Неизвестная команда: ${command}. Есть: run, stats, recipients`);
      process.exitCode = 1;
      return;
    }

    const dryRun = flag('dry-run');
    const kind = args.includes('--kind') ? args[args.indexOf('--kind') + 1] : 'weekly';
    const limitArg = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : 50;

    if (!dryRun) {
      // Без транспорта письма уйдут «в лог»: на проде это значит, что
      // люди ничего не получат, и об этом надо сказать громко
      if (!assertMailReady() || transportKind === 'console') {
        console.warn('[рассылка] почта не настроена: письма пишутся в лог, а не отправляются');
      }
    }

    const result = await digest.run({ kind, dryRun, limit: Number.isFinite(limitArg) ? limitArg : 50 });

    if (dryRun) {
      console.log(`[рассылка] пробный прогон: собрано ${result.letters.length} писем из ${result.candidates} кандидатов`);
      result.letters.slice(0, 3).forEach((letter) => {
        console.log(`\n--- ${letter.to}\nТема: ${letter.subject}\n${letter.text}`);
      });
      if (result.letters.length > 3) console.log(`\n... и ещё ${result.letters.length - 3}`);
      return;
    }

    console.log(`[рассылка] ${kind}: отправлено ${result.sent}, пропущено ${result.skipped}, ошибок ${result.failed}`);
    if (result.failed) process.exitCode = 1;
  } finally {
    await db.close();
  }
  // см. migrate-cli: воркер PGlite не даёт процессу завершиться сам
  process.exit(process.exitCode || 0);
}

main().catch((error) => {
  console.error(`[рассылка] не удалось: ${error.message}`);
  process.exitCode = 1;
});
