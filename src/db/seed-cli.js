'use strict';

/**
 * Наполнение базы из папки content/.
 *
 *   npm run content:load              # залить, не трогая существующие книги
 *   npm run content:load -- --update  # обновить описания и года существующих
 *   npm run content:check             # только проверить файлы, без записи
 *
 * Скрипт отдельный от сида намеренно: сид — это демо для разработки
 * (5 читателей, полки, рецензии), а наполнение — боевой каталог, который
 * нужен и на проде, где демо-аккаунтам не место.
 */

require('dotenv').config({ quiet: true });

const { loadContent, contentDir } = require('../config/content');
const { validateContent } = require('../lib/content');
const { plural } = require('../lib/text');

/**
 * База выбирается так же, как у сайта (src/config/db-driver.js): если
 * Postgres не установлен, работает встроенная. Результат — { sequelize,
 * models, close }: соединение закрываем в finally, иначе процесс висит.
 */
function openDatabase() {
  return require('./open').openDatabase({ migrate: true });
}

async function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const update = args.includes('--update');

  const content = loadContent({ dir: contentDir(), required: ['books'] });
  const genres = require('./seed').GENRES;
  const validated = validateContent(content, { genres });

  validated.warnings.forEach((warning) => console.warn(`[контент] предупреждение: ${warning}`));

  if (validated.errors.length) {
    console.error(`[контент] ошибок: ${validated.errors.length}. Ничего не загружено.`);
    validated.errors.slice(0, 30).forEach((error) => console.error(`  - ${error}`));
    process.exitCode = 1;
    return;
  }

  console.log(`[контент] проверка пройдена: ${validated.books.length} книг, `
    + `${validated.collections.length} подборок, ${validated.authors.length} авторов, `
    + `${validated.clubs.length} ${plural(validated.clubs.length, ['клуб', 'клуба', 'клубов'])}`);

  if (checkOnly) return;

  const db = await openDatabase();
  try {
    const { sequelize, models } = db;
    const { createContentService } = require('../services/content');
    const service = createContentService({
      Book: models.Book,
      BookGenre: models.BookGenre,
      Genre: models.Genre,
      Collection: models.Collection,
      CollectionBook: models.CollectionBook,
      Author: models.Author,
      Club: models.Club,
      ClubMember: models.ClubMember,
      ClubSchedule: models.ClubSchedule,
      User: models.User,
      sequelize
    });

    const applied = await service.apply(validated, { update });
    console.log('[контент] книги:',
      `создано ${applied.books.created}, обновлено ${applied.books.updated}, пропущено ${applied.books.skipped}`);
    console.log('[контент] подборки:', `создано ${applied.collections.created}, обновлено ${applied.collections.updated}, связей ${applied.collections.books}`);
    console.log('[контент] авторы:', `создано ${applied.authors.created}, обновлено ${applied.authors.updated}`);
    console.log('[контент] клубы:', `создано ${applied.clubs.created}, пропущено ${applied.clubs.skipped}`);
    if (applied.clubs.missingOwners.length) {
      console.warn(`[контент] клубы без ведущего: ${applied.clubs.missingOwners.join(', ')}. `
        + 'Создай этих людей заранее или укажи ownerEmail существующего аккаунта.');
    }
    console.log('[контент] в базе:', await service.stats());
  } finally {
    await db.close();
  }
  // см. migrate-cli: воркер PGlite не даёт процессу завершиться сам
  process.exit(process.exitCode || 0);
}

main().catch((error) => {
  console.error('[контент] упало:', error.message);
  process.exitCode = 1;
});
