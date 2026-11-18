'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { createTestApp, extractCsrf } = require('../support/app');
const { streaks, dayKey, yearRange } = require('../../src/services/stats');
const { renderYearCard, buildSvg, pluralBooks, escapeXml } = require('../../src/services/poster');

/**
 * Статистика и «Книжный год».
 *
 * Числа проверяются на заранее посчитанных вручную данных:
 * три книги по 300, 200 и 100 страниц = 600 страниц;
 * две закрыты в марте, одна в июле;
 * серия — три дня подряд 1, 2 и 3 марта.
 */

const DAY = 86400000;

function utc(year, month, day, hour = 12) {
  return new Date(Date.UTC(year, month - 1, day, hour));
}

test('серия дней: считает текущую и самую длинную', () => {
  const days = [
    utc(2026, 3, 1), utc(2026, 3, 2), utc(2026, 3, 3),
    utc(2026, 3, 10), utc(2026, 3, 11)
  ];
  const today = utc(2026, 3, 11, 20);

  const result = streaks(days, today);
  assert.equal(result.longest, 3, 'самая длинная серия — 1–3 марта');
  assert.equal(result.current, 2, 'текущая серия — 10 и 11 марта');

  // Пустой список
  assert.deepEqual(streaks([], today), { current: 0, longest: 0 });

  // Один день подряд
  assert.deepEqual(streaks([utc(2026, 5, 5)], utc(2026, 5, 5)), { current: 1, longest: 1 });

  // Серия оборвалась: сегодня записи нет, вчера была — текущая всё равно считается
  assert.equal(streaks([utc(2026, 5, 4), utc(2026, 5, 5)], utc(2026, 5, 6)).current, 2);
});

test('границы года и ключ дня — в UTC', () => {
  const range = yearRange(2026);
  assert.equal(range.start.toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(range.end.toISOString(), '2027-01-01T00:00:00.000Z');
  assert.equal(dayKey(new Date('2026-03-01T23:59:00Z')), '2026-03-01');
});

test('цифры за год совпадают с расчётом вручную', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const user = await ctx.createUser({ email: 'anna@example.com', name: 'Анна' });
  const stats = ctx.services.statsService;

  const books = await Promise.all([
    ctx.models.Book.create({ slug: 'kniga-a', title: 'Книга А', author: 'Автор', pages: 300, isPublished: true }),
    ctx.models.Book.create({ slug: 'kniga-b', title: 'Книга Б', author: 'Автор', pages: 200, isPublished: true }),
    ctx.models.Book.create({ slug: 'kniga-v', title: 'Книга В', author: 'Автор', pages: 100, isPublished: true })
  ]);

  // Две книги закрыты в марте, одна в июле
  await ctx.models.LibraryEntry.create({
    userId: user.id, bookId: books[0].id, status: 'read', finishedAt: utc(2026, 3, 1)
  });
  await ctx.models.LibraryEntry.create({
    userId: user.id, bookId: books[1].id, status: 'read', finishedAt: utc(2026, 3, 3)
  });
  await ctx.models.LibraryEntry.create({
    userId: user.id, bookId: books[2].id, status: 'read', finishedAt: utc(2026, 7, 15)
  });
  // Книга в процессе — в «прочитано» не попадает
  await ctx.models.LibraryEntry.create({
    userId: user.id, bookId: books[0].id, status: 'reading', finishedAt: null
  }).catch(() => null);

  const summary = await stats.summary({ userId: user.id, year: 2026 });
  assert.equal(summary.booksRead, 3, 'три книги закрыты в 2026');
  assert.equal(summary.pagesRead, 600, '300 + 200 + 100 = 600 страниц');

  // Прошлый год — пусто
  const lastYear = await stats.summary({ userId: user.id, year: 2025 });
  assert.equal(lastYear.booksRead, 0);
  assert.equal(lastYear.pagesRead, 0);

  const months = await stats.byMonth(user.id, 2026);
  assert.equal(months[2].count, 2, 'в марте две книги');
  assert.equal(months[6].count, 1, 'в июле одна');
  assert.equal(months.reduce((sum, month) => sum + month.count, 0), 3);

  const map = await stats.activityMap(user.id, 2026);
  assert.equal(map.days.length, 365, '2026 год — 365 дней');
  assert.ok(map.days.every((day) => day.level >= 0 && day.level <= 4));
  assert.equal(dayKey(map.days[0].date), '2026-01-01');
  assert.equal(dayKey(map.days[364].date), '2026-12-31');
});

test('любимые жанры считаются по закрытым книгам года', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const user = await ctx.createUser({ email: 'anna@example.com', name: 'Анна' });
  const fantasy = await ctx.models.Genre.create({ slug: 'fantastika', name: 'Фантастика' });

  const bookA = await ctx.models.Book.create({ slug: 'a', title: 'А', author: 'Автор', pages: 100, isPublished: true });
  const bookB = await ctx.models.Book.create({ slug: 'b', title: 'Б', author: 'Автор', pages: 100, isPublished: true });
  await bookA.addGenre(fantasy);
  await bookB.addGenre(fantasy);

  await ctx.models.LibraryEntry.create({ userId: user.id, bookId: bookA.id, status: 'read', finishedAt: utc(2026, 2, 2) });
  await ctx.models.LibraryEntry.create({ userId: user.id, bookId: bookB.id, status: 'read', finishedAt: utc(2026, 2, 5) });

  const genres = await ctx.services.statsService.topGenres(user.id, 2026);
  assert.equal(genres.length, 1);
  assert.equal(genres[0].name, 'Фантастика');
  assert.equal(genres[0].count, 2);
});

test('страница статистики и «Книжный год» открываются', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await ctx.createUser({ email: 'anna@example.com', name: 'Анна' });
  await ctx.login(anna);

  const statsPage = await ctx.agent.get('/statistika');
  assert.equal(statsPage.status, 200);
  assert.match(statsPage.text, /книг закрыто/);
  assert.match(statsPage.text, /Карта года/);

  const yearPage = await ctx.agent.get('/knizhnyy-god');
  assert.equal(yearPage.status, 200);
  assert.match(yearPage.text, /Ваш книжный год/);
  assert.match(yearPage.text, /Скачать для сторис 1080×1350/);
});

test('статистика закрытого профиля недоступна посторонним', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const request = require('supertest');
  const boris = await ctx.createUser({ email: 'boris@example.com', name: 'Борис' });
  await ctx.models.User.update({ isPrivate: true }, { where: { id: boris.id } });

  const anna = await ctx.createUser({ email: 'anna@example.com', name: 'Анна' });
  const guest = request.agent(ctx.app);
  await ctx.login(anna, 'reader2026', guest);

  const closed = await guest.get(`/chitateli/${boris.id}/statistika`);
  assert.equal(closed.status, 403, 'закрытая статистика отдаёт 403');

  // После подписки — открывается
  await ctx.services.socialService.follow({ followerId: anna.id, followingId: boris.id });
  const open = await guest.get(`/chitateli/${boris.id}/statistika`);
  assert.equal(open.status, 200);
});

test('картинка «Книжный год»: правильные размеры, валидный PNG, быстрее секунды', async () => {
  const data = {
    year: 2026,
    name: 'Анна',
    books: 42,
    pages: 11380,
    reviews: 17,
    streak: 9,
    genres: [{ name: 'Фантастика', count: 12 }, { name: 'Классика', count: 8 }]
  };

  for (const [size, expected] of [['story', [1080, 1350]], ['square', [1080, 1080]]]) {
    const started = Date.now();
    const card = await renderYearCard(data, { size });
    const elapsed = Date.now() - started;

    assert.ok(elapsed < 1000, `PNG за ${elapsed} мс — медленнее секунды`);
    assert.deepEqual([card.width, card.height], expected);

    // Настоящий PNG: сигнатура + размеры внутри IHDR + разбор sharp
    assert.equal(card.buffer.slice(1, 4).toString('ascii'), 'PNG');
    const meta = await sharp(card.buffer).metadata();
    assert.equal(meta.format, 'png');
    assert.equal(meta.width, expected[0]);
    assert.equal(meta.height, expected[1]);
    assert.ok(card.buffer.length > 5000, 'картинка не должна быть пустой заглушкой');
  }
});

test('SVG-карточка экранирует пользовательский текст', () => {
  const svg = buildSvg({ year: 2026, name: '<script>alert(1)</script>', books: 1 }, 'square');
  // Текст рисуется в верхнем регистре, поэтому проверяем без учёта регистра
  assert.ok(!/<script/i.test(svg), 'тег из имени не должен попасть в SVG');
  assert.match(svg, /&lt;script&gt;/i);

  assert.equal(escapeXml('a & b'), 'a &amp; b');
  assert.equal(pluralBooks(1), 'книга');
  assert.equal(pluralBooks(3), 'книги');
  assert.equal(pluralBooks(11), 'книг');
  assert.equal(pluralBooks(21), 'книга');
});

test('достижения выдаются по фактическим числам', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const user = await ctx.createUser({ email: 'anna@example.com', name: 'Анна' });
  const book = await ctx.models.Book.create({ slug: 'tolstay', title: 'Толстая', author: 'Автор', pages: 1200, isPublished: true });
  await ctx.models.LibraryEntry.create({ userId: user.id, bookId: book.id, status: 'read', finishedAt: utc(2026, 4, 4) });

  const list = await ctx.services.statsService.achievements(user.id, 2026);
  const unlocked = list.filter((item) => item.unlocked).map((item) => item.key);

  assert.ok(unlocked.includes('first-book'));
  assert.ok(unlocked.includes('thousand-pages'), '1200 страниц перекрывает достижение о тысяче');
  assert.ok(!unlocked.includes('five-books'));
  assert.ok(!unlocked.includes('fifty-books'));
  assert.equal(list.length >= 10, true, 'достижений должно быть много');
});

test('картинка отдаётся только своему читателю', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await ctx.createUser({ email: 'anna@example.com', name: 'Анна' });
  await ctx.login(anna);

  const image = await ctx.agent.get('/knizhnyy-god/kartinka?format=story');
  assert.equal(image.status, 200);
  assert.equal(image.headers['content-type'], 'image/png');
  assert.match(image.headers['content-disposition'], /knizhnyy-god-2026-story\.png/);

  // Гость — на вход
  const guestRequest = require('supertest');
  const guest = await guestRequest.agent(ctx.app).get('/knizhnyy-god/kartinka');
  assert.equal(guest.status, 303);
});

void DAY;
