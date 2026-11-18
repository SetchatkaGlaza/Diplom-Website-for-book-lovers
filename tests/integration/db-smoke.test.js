'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('../support/db');

test('схема создаётся, модели связаны и данные сохраняются', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  await db.reset();

  const { User, Book, LibraryEntry } = db.models;

  const user = await User.create({
    email: 'anna@example.com',
    name: 'Анна',
    passwordHash: 'x'.repeat(60)
  });
  const book = await Book.create({
    slug: 'master-i-margarita',
    title: 'Мастер и Маргарита',
    author: 'Михаил Булгаков',
    pages: 480
  });

  await LibraryEntry.create({
    userId: user.id,
    bookId: book.id,
    status: 'reading',
    currentPage: 120
  });

  const entries = await LibraryEntry.findAll({ where: { userId: user.id } });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].bookId, book.id);

  const withBook = await LibraryEntry.findOne({
    where: { userId: user.id },
    include: [{ model: Book, as: 'book' }]
  });
  assert.equal(withBook.book.title, 'Мастер и Маргарита');
});

test('уникальный e-mail не даёт создать второго пользователя', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  await db.reset();

  const { User } = db.models;
  await User.create({ email: 'dup@example.com', name: 'Первый', passwordHash: 'x'.repeat(60) });

  await assert.rejects(
    () => User.create({ email: 'dup@example.com', name: 'Второй', passwordHash: 'y'.repeat(60) }),
    (error) => {
      assert.ok(/unique|duplicate|уникал/i.test(error.message + String(error.parent && error.parent.message)));
      return true;
    }
  );
});
