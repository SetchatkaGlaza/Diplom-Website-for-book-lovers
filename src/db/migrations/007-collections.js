'use strict';

/**
 * Подборки книг и страницы авторов.
 *
 * Подборка — это редакционный список («Что читать, если давно не читал»),
 * а не полка читателя: у неё есть адрес, описание и порядок книг.
 * Порядок важен, поэтому в связке лежит position, а не только пара id.
 *
 * Автор — не справочник ради справки: страница нужна, чтобы из карточки
 * книги можно было перейти к человеку и увидеть всё его, что есть в каталоге.
 */
async function up(queryInterface) {
  const run = (sql) => queryInterface.sequelize.query(sql);

  await run(`
    CREATE TABLE IF NOT EXISTS collections (
      id SERIAL PRIMARY KEY,
      slug VARCHAR(200) NOT NULL UNIQUE,
      title VARCHAR(200) NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      is_published BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 100,
      views_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

  await run(`
    CREATE TABLE IF NOT EXISTS collection_books (
      id SERIAL PRIMARY KEY,
      collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      note VARCHAR(300) NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

  await run('CREATE UNIQUE INDEX IF NOT EXISTS collection_books_pair_idx ON collection_books (collection_id, book_id)');
  await run('CREATE INDEX IF NOT EXISTS collection_books_book_idx ON collection_books (book_id)');

  await run(`
    CREATE TABLE IF NOT EXISTS authors (
      id SERIAL PRIMARY KEY,
      slug VARCHAR(200) NOT NULL UNIQUE,
      name VARCHAR(160) NOT NULL,
      years VARCHAR(40) NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

  await run('CREATE INDEX IF NOT EXISTS authors_name_idx ON authors (name)');
}

async function down(queryInterface) {
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS authors');
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS collection_books');
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS collections');
}

module.exports = { up, down };
