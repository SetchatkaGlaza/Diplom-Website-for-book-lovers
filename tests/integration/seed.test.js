'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Sequelize } = require('sequelize');
const { createTestDatabase } = require('../support/db');
const { migrateUp } = require('../../src/db/migrator');
const { seed, seedAdmin } = require('../../src/db/seed');

const DIR = path.join(__dirname, '..', '..', 'src', 'db', 'migrations');

async function prepared() {
  const db = await createTestDatabase();
  await migrateUp(db.sequelize, Sequelize, { dir: DIR, useTransactions: false });
  return db;
}

test('сид наполняет базу и не создаёт дубли при повторном запуске', async (t) => {
  const db = await prepared();
  t.after(() => db.close());

  const first = await seed({ sequelize: db.sequelize, models: db.models, verbose: false });
  assert.equal(first.genres, 20);
  assert.ok(first.books >= 60, `ожидали 60+ книг, получили ${first.books}`);
  assert.equal(first.users, 5);

  const second = await seed({ sequelize: db.sequelize, models: db.models, verbose: false });
  assert.equal(second.books, first.books, 'книги не должны дублироваться');

  const booksCount = await db.models.Book.count();
  assert.equal(booksCount, first.books);

  const usersCount = await db.models.User.count();
  assert.equal(usersCount, 5);

  const genresCount = await db.models.Genre.count();
  assert.equal(genresCount, 20);
});

test('у книг есть жанры, у пользователей — полки и рецензии', async (t) => {
  const db = await prepared();
  t.after(() => db.close());
  await seed({ sequelize: db.sequelize, models: db.models, verbose: false });

  const bookWithGenres = await db.models.Book.findOne({
    include: [{ model: db.models.Genre, as: 'genres' }]
  });
  assert.ok(bookWithGenres.genres.length >= 1, 'у книги должен быть жанр');

  assert.ok(await db.models.LibraryEntry.count() > 0, 'полки должны быть заполнены');
  assert.ok(await db.models.Review.count() > 0, 'рецензии должны быть');
  assert.ok(await db.models.Club.count() === 3, 'должно быть три клуба');

  const review = await db.models.Review.findOne();
  assert.ok(review.getStars() >= 1 && review.getStars() <= 5, 'звёзды должны быть в диапазоне 1–5');

  const readEntries = await db.models.LibraryEntry.findAll({ where: { status: 'read' } });
  for (const entry of readEntries) {
    assert.ok(entry.finishedAt, 'прочитанная книга должна иметь дату окончания');
  }
});

test('пароль сид-пользователей работает с bcrypt', async (t) => {
  const db = await prepared();
  t.after(() => db.close());
  await seed({ sequelize: db.sequelize, models: db.models, verbose: false });

  const bcrypt = require('bcrypt');
  const user = await db.models.User.findOne({ where: { email: 'anna@example.com' } });
  assert.ok(user);
  assert.equal(await bcrypt.compare('reader2026', user.passwordHash), true);
  assert.equal(await bcrypt.compare('неверный', user.passwordHash), false);
  assert.equal(user.role, 'admin');
});

test('первый администратор: создаётся один раз и не тянет за собой демо-читателей', async (t) => {
  const db = await prepared();
  t.after(() => db.close());

  const first = await seedAdmin({
    sequelize: db.sequelize,
    models: db.models,
    email: 'Boss@Knigomany.ru',
    password: 'silnyy-parol-2026',
    verbose: false
  });
  assert.equal(first.created, true);
  assert.equal(first.email, 'boss@knigomany.ru', 'адрес приводится к нижнему регистру');
  assert.ok(first.password.length >= 12, 'пароль не короче 12 символов');

  const user = await db.models.User.findOne({ where: { email: 'boss@knigomany.ru' } });
  assert.equal(user.role, 'admin');
  assert.ok(user.emailVerifiedAt, 'админ не должен зависеть от письма с подтверждением');
  assert.equal(await db.models.User.count(), 1, 'демо-читатели на проде не нужны');

  const again = await seedAdmin({
    sequelize: db.sequelize,
    models: db.models,
    email: 'boss@knigomany.ru',
    verbose: false
  });
  assert.equal(again.created, false, 'повторный запуск не создаёт второго админа');
  assert.equal(await db.models.User.count(), 1);
});

test('первый администратор: без адреса — понятная ошибка, а не пустой аккаунт', async (t) => {
  const db = await prepared();
  t.after(() => db.close());

  await assert.rejects(
    () => seedAdmin({ sequelize: db.sequelize, models: db.models, email: '  ', verbose: false }),
    /ADMIN_EMAIL/
  );
});
