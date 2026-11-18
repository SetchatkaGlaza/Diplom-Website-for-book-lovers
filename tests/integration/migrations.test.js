'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Sequelize } = require('sequelize');
const { createTestDatabase } = require('../support/db');
const { migrateUp, migrateDown, migrationStatus, MIGRATIONS_TABLE } = require('../../src/db/migrator');

const DIR = path.join(__dirname, '..', '..', 'src', 'db', 'migrations');

// Файлы миграций идут по порядку номеров в имени — так же, как их применяет мигратор.
const ALL = fs.readdirSync(DIR).filter((name) => name.endsWith('.js')).sort();
const LAST = ALL[ALL.length - 1];

/**
 * Список таблиц через queryInterface: прямой SELECT по information_schema
 * в PGlite возвращает только частичный результат, а showAllTables работает.
 */
async function tables(sequelize) {
  return (await sequelize.getQueryInterface().showAllTables()).sort();
}

test('миграция накатывает полную схему', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());

  const applied = await migrateUp(db.sequelize, Sequelize, { dir: DIR, useTransactions: false });
  assert.deepEqual(applied, ALL, 'должны примениться все миграции по порядку');

  const list = await tables(db.sequelize);
  for (const expected of [
    'users', 'books', 'genres', 'book_genres', 'library_entries', 'reviews',
    'review_likes', 'review_comments', 'follows', 'clubs', 'club_members',
    'club_posts', 'notifications', 'activities', 'reading_goals', 'reports',
    'conversations', 'messages', 'user_sessions', 'user_tokens', MIGRATIONS_TABLE
  ]) {
    assert.ok(list.includes(expected), `нет таблицы ${expected}`);
  }
});

test('повторный накат ничего не делает', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());

  await migrateUp(db.sequelize, Sequelize, { dir: DIR, useTransactions: false });
  const second = await migrateUp(db.sequelize, Sequelize, { dir: DIR, useTransactions: false });
  assert.deepEqual(second, [], 'второй прогон не должен применять миграции');
});

test('откат снимает миграции по одной, полный откат убирает все таблицы', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());

  await migrateUp(db.sequelize, Sequelize, { dir: DIR, useTransactions: false });

  // Шаг назад снимает только последнюю миграцию и её поле
  const step = await migrateDown(db.sequelize, Sequelize, { dir: DIR, useTransactions: false });
  assert.deepEqual(step, [LAST], 'откат снимает последнюю миграцию');

  // Остальные шаги снимают всё до первой
  const rest = await migrateDown(db.sequelize, Sequelize, {
    dir: DIR, steps: ALL.length, useTransactions: false
  });
  assert.deepEqual(rest, ALL.slice(0, -1).reverse(), 'дальше идут по одной, от последней к первой');

  const afterDown = await tables(db.sequelize);
  assert.ok(!afterDown.includes('users'), 'таблицы должны исчезнуть');
  assert.ok(!afterDown.includes('books'));

  const again = await migrateUp(db.sequelize, Sequelize, { dir: DIR, useTransactions: false });
  assert.deepEqual(again, ALL, 'повторный накат возвращает всю схему');
  assert.ok((await tables(db.sequelize)).includes('users'));
});

test('изменение уже применённой миграции обнаруживается', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const os = require('node:os');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  const file = path.join(tempDir, '001-test.js');
  fs.writeFileSync(file, `module.exports = {
    up: async (q) => { await q.sequelize.query('CREATE TABLE t1 (id serial primary key)'); },
    down: async (q) => { await q.sequelize.query('DROP TABLE IF EXISTS t1'); }
  };`);

  await migrateUp(db.sequelize, Sequelize, { dir: tempDir, useTransactions: false });

  fs.writeFileSync(file, `module.exports = {
    up: async (q) => { await q.sequelize.query('CREATE TABLE t2 (id serial primary key)'); },
    down: async (q) => { await q.sequelize.query('DROP TABLE IF EXISTS t2'); }
  };`);

  await assert.rejects(
    () => migrateUp(db.sequelize, Sequelize, { dir: tempDir, useTransactions: false }),
    /файл изменён/
  );

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('статус показывает применённые миграции', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());

  await migrateUp(db.sequelize, Sequelize, { dir: DIR, useTransactions: false });
  const status = await migrationStatus(db.sequelize, Sequelize, { dir: DIR, useTransactions: false });
  assert.equal(status.length, ALL.length);
  assert.ok(status.every((item) => item.applied === true), 'все миграции отмечены применёнными');
  assert.deepEqual(status.map((item) => item.name), ALL, 'порядок совпадает с файлами');
});

test('ограничения схемы работают: дубли, рейтинг, самоподписка, порядок диалога', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  await migrateUp(db.sequelize, Sequelize, { dir: DIR, useTransactions: false });

  const { sequelize } = db;

  const [user] = await sequelize.query(
    "INSERT INTO users (name, email, password_hash) VALUES ('Анна', 'anna@example.com', 'x') RETURNING id"
  );
  assert.ok(user[0].id);

  // дубль e-mail: Sequelize нормализует ошибку в SequelizeUniqueConstraintError
  await assert.rejects(
    () => sequelize.query("INSERT INTO users (name, email, password_hash) VALUES ('Ещё', 'anna@example.com', 'y')"),
    (error) => error.name === 'SequelizeUniqueConstraintError'
  );

  const [book] = await sequelize.query(
    "INSERT INTO books (slug, title, author) VALUES ('kniga', 'Книга', 'Автор') RETURNING id"
  );
  const bookId = book[0].id;

  // рейтинг вне диапазона 1–10 (половинки хранятся как целые)
  await assert.rejects(
    () => sequelize.query(
      `INSERT INTO reviews (user_id, book_id, rating, body) VALUES (${user[0].id}, ${bookId}, 11, 'текст')`
    ),
    (error) => /reviews_rating_half_step/.test(error.message) || error.name === 'SequelizeDatabaseError'
  );

  // самоподписка
  await assert.rejects(
    () => sequelize.query(
      `INSERT INTO follows (follower_id, following_id) VALUES (${user[0].id}, ${user[0].id})`
    ),
    (error) => /follows_not_self/.test(error.message) || error.name === 'SequelizeDatabaseError'
  );

  // дубль на полке
  await sequelize.query(
    `INSERT INTO library_entries (user_id, book_id) VALUES (${user[0].id}, ${bookId})`
  );
  await assert.rejects(
    () => sequelize.query(
      `INSERT INTO library_entries (user_id, book_id) VALUES (${user[0].id}, ${bookId})`
    ),
    (error) => error.name === 'SequelizeUniqueConstraintError'
  );

  // диалог хранится в порядке возрастания id
  const [second] = await sequelize.query(
    "INSERT INTO users (name, email, password_hash) VALUES ('Борис', 'boris@example.com', 'x') RETURNING id"
  );
  await assert.rejects(
    () => sequelize.query(
      `INSERT INTO conversations (user_a_id, user_b_id) VALUES (${second[0].id}, ${user[0].id})`
    ),
    (error) => /conversations_order/.test(error.message) || error.name === 'SequelizeDatabaseError'
  );
});
