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

const path = require('node:path');
const { Sequelize } = require('sequelize');
const { loadContent, contentDir } = require('../config/content');
const { validateContent } = require('../lib/content');
const { plural } = require('../lib/text');

async function openDatabase() {
  if (process.env.DB_DRIVER === 'pglite') {
    const { createPgliteSequelize } = require('../config/pglite');
    const { defineModels } = require('../models');
    const { migrateUp } = require('../db/migrator');
    const sequelize = await createPgliteSequelize({ dataDir: process.env.PGLITE_DATA_DIR || null });
    const models = defineModels(sequelize);
    await migrateUp(sequelize, Sequelize, {
      dir: path.join(__dirname, 'migrations'),
      useTransactions: false
    });
    return { sequelize, models, owned: true };
  }

  const index = require('../models');
  await index.sequelize.authenticate();
  return { sequelize: index.sequelize, models: index, owned: false };
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

  const { sequelize, models, owned } = await openDatabase();
  try {
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
    if (owned) await sequelize.close();
    else if (process.env.DB_DRIVER !== 'pglite') await sequelize.close();
  }
}

main().catch((error) => {
  console.error('[контент] упало:', error.message);
  process.exitCode = 1;
});
