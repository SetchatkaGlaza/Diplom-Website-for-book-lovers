'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createTestApp, extractCsrf } = require('../support/app');

/**
 * Каталог проверяется через настоящие HTTP-запросы: важно, что видит человек,
 * а не что вернула функция.
 */

/** Создаёт жанр и книгу с нужными полями. Жанр переиспользуется по слагу. */
async function makeBook(ctx, data = {}) {
  // Имя жанра уникально в схеме, поэтому по умолчанию оно тоже случайное
  const suffix = Math.random().toString(36).slice(2, 8);
  const genreName = data.genreName || `Жанр ${suffix}`;
  const genreSlug = data.genreSlug || `zhanr-${suffix}`;
  const [genre] = data.genre
    ? [data.genre]
    : await ctx.models.Genre.findOrCreate({
      where: { slug: genreSlug },
      defaults: { name: genreName, slug: genreSlug, sortOrder: 1 }
    });

  const book = await ctx.models.Book.create({
    slug: data.slug || `kniga-${Math.random().toString(36).slice(2, 10)}`,
    title: data.title || 'Тестовая книга',
    author: data.author || 'Тестовый автор',
    year: data.year || 2020,
    pages: data.pages || 300,
    description: data.description || '',
    isPublished: data.isPublished !== false
  });

  if (data.withGenre !== false) {
    await ctx.models.BookGenre.create({ bookId: book.id, genreId: genre.id });
  }

  return { book, genre };
}

/** Названия книг из выдачи каталога — в порядке показа. */
function titlesFrom(html) {
  const matches = html.match(/book-card__title">([^<]+)</g) || [];
  return matches.map((piece) => piece.replace(/^book-card__title">/, '').replace(/<$/, ''));
}

test('каталог показывает книги и общее количество', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  await makeBook(ctx, { title: 'Дюна', author: 'Фрэнк Герберт' });
  await makeBook(ctx, { title: 'Солярис', author: 'Станислав Лем' });

  const response = await ctx.request.get('/knigi');
  assert.equal(response.status, 200);
  assert.deepEqual(titlesFrom(response.text).sort(), ['Дюна', 'Солярис']);
  assert.match(response.text, /2 книги/);
});

test('поиск находит по автору, по названию и по нескольким словам', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  await makeBook(ctx, { title: 'Мастер и Маргарита', author: 'Михаил Булгаков' });
  await makeBook(ctx, { title: 'Белая гвардия', author: 'Михаил Булгаков' });
  await makeBook(ctx, { title: 'Солярис', author: 'Станислав Лем' });

  const byAuthor = await ctx.request.get('/knigi').query({ q: 'булгаков' });
  assert.deepEqual(titlesFrom(byAuthor.text).sort(), ['Белая гвардия', 'Мастер и Маргарита']);

  const byTitle = await ctx.request.get('/knigi').query({ q: 'соляр' });
  assert.deepEqual(titlesFrom(byTitle.text), ['Солярис']);

  // Оба слова должны встретиться: это отсекает «нашлось всё подряд»
  const twoWords = await ctx.request.get('/knigi').query({ q: 'мастер булгаков' });
  assert.deepEqual(titlesFrom(twoWords.text), ['Мастер и Маргарита']);

  const mismatch = await ctx.request.get('/knigi').query({ q: 'мастер лем' });
  assert.equal(titlesFrom(mismatch.text).length, 0);
  assert.match(mismatch.text, /Ничего не нашлось/);
});

test('поиск не ломается на служебных символах и очень длинной строке', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());
  await makeBook(ctx, { title: 'Дюна' });

  for (const q of ['%', '_', '%%%', '\\', "'; DROP TABLE books; --", 'а'.repeat(500)]) {
    const response = await ctx.request.get('/knigi').query({ q });
    assert.equal(response.status, 200, `запрос «${q.slice(0, 20)}» сломал каталог`);
  }

  // Таблица на месте — значит, ничего не «дропнулось»
  assert.equal(await ctx.models.Book.count(), 1);
});

test('фильтр по жанру и понятный ответ на несуществующий жанр', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const fantastic = await ctx.models.Genre.create({ name: 'Фантастика', slug: 'fantastika', sortOrder: 1 });
  await makeBook(ctx, { title: 'Дюна', genre: fantastic });
  await makeBook(ctx, { title: 'Хоббит', genreName: 'Фэнтези', genreSlug: 'fentezi' });

  const filtered = await ctx.request.get('/knigi').query({ zhanr: 'fantastika' });
  assert.deepEqual(titlesFrom(filtered.text), ['Дюна']);
  assert.match(filtered.text, /Фантастика/);

  // Жанр + поиск вместе
  const both = await ctx.request.get('/knigi').query({ zhanr: 'fantastika', q: 'хоббит' });
  assert.equal(titlesFrom(both.text).length, 0);

  const missing = await ctx.request.get('/knigi').query({ zhanr: 'net-takogo' });
  assert.equal(missing.status, 200);
  assert.match(missing.text, /Такого жанра нет/);
});

test('сортировки: по году, по названию; мусор в сортировке безопасен', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  await makeBook(ctx, { title: 'Б', year: 1900 });
  await makeBook(ctx, { title: 'А', year: 2020 });

  const byYear = await ctx.request.get('/knigi').query({ sort: 'year' });
  assert.deepEqual(titlesFrom(byYear.text), ['А', 'Б']);

  const byTitle = await ctx.request.get('/knigi').query({ sort: 'title' });
  assert.deepEqual(titlesFrom(byTitle.text), ['А', 'Б']);

  const brokenSort = await ctx.request.get('/knigi').query({ sort: 'rating; DROP TABLE books' });
  assert.equal(brokenSort.status, 200);
  assert.equal(await ctx.models.Book.count(), 2);
});

test('постраничная выдача: 24 на страницу, кривой номер не ломает', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const genre = await ctx.models.Genre.create({ name: 'Жанр', slug: 'zhanr', sortOrder: 1 });
  const rows = [];
  for (let i = 1; i <= 30; i += 1) {
    rows.push({
      slug: `kniga-${i}`, title: `Книга ${String(i).padStart(2, '0')}`,
      author: 'Автор', isPublished: true, cover: 'default-cover.svg'
    });
  }
  await ctx.models.Book.bulkCreate(rows);
  const all = await ctx.models.Book.findAll({ attributes: ['id'] });
  await ctx.models.BookGenre.bulkCreate(all.map((book) => ({ bookId: book.id, genreId: genre.id })));

  const first = await ctx.request.get('/knigi').query({ sort: 'title' });
  assert.equal(titlesFrom(first.text).length, 24);
  assert.match(first.text, /Страница 1 из 2/);

  const second = await ctx.request.get('/knigi').query({ sort: 'title', page: 2 });
  assert.equal(titlesFrom(second.text).length, 6);

  // Страница за пределами — показываем последнюю, а не пустоту
  const tooFar = await ctx.request.get('/knigi').query({ sort: 'title', page: 999 });
  assert.match(tooFar.text, /Страница 2 из 2/);

  for (const page of ['0', '-3', 'abc', '1.5', '']) {
    const response = await ctx.request.get('/knigi').query({ page });
    assert.equal(response.status, 200, `page=${page} сломал каталог`);
  }
});

test('карточка книги: данные, жанры, счётчики и похожие книги', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const fantastic = await ctx.models.Genre.create({ name: 'Фантастика', slug: 'fantastika', sortOrder: 1 });
  const { book } = await makeBook(ctx, {
    slug: 'duna', title: 'Дюна', author: 'Фрэнк Герберт', genre: fantastic,
    description: 'Планета песка и пряности.', year: 1965, pages: 704
  });
  const sameAuthor = await makeBook(ctx, { slug: 'duna-2', title: 'Дюна-2', author: 'Фрэнк Герберт', genre: fantastic });
  await makeBook(ctx, { slug: 'drugaya', title: 'Другая', author: 'Другой автор', genre: fantastic });

  const user = await ctx.createUser({ email: 'anna3@example.com' });
  await ctx.models.Review.create({
    userId: user.id, bookId: book.id, rating: 9, title: 'Отлично', body: 'Очень длинная рецензия для проверки вывода.'
  });
  await ctx.models.LibraryEntry.create({ userId: user.id, bookId: book.id, status: 'reading' });
  // Обычно агрегаты пересчитывает сервис рецензий (этап 8); здесь ставим руками
  await book.update({ ratingsCount: 1, ratingsSum: 9, reviewsCount: 1 });

  const response = await ctx.request.get('/knigi/duna');
  assert.equal(response.status, 200);
  assert.match(response.text, /<title>Дюна — Книгоманы<\/title>/);
  assert.match(response.text, /Фрэнк Герберт/);
  assert.match(response.text, /Планета песка и пряности/);
  assert.match(response.text, /4\.5 из 5/);
  assert.match(response.text, /1965/);
  assert.match(response.text, /704/);
  assert.match(response.text, /Фантастика/);
  assert.match(response.text, /Отлично/);

  // Похожие: книга того же автора есть, сама книга в похожих не попадает
  assert.match(response.text, /Ещё этого автора/);
  assert.match(response.text, /Дюна-2/);
  const similarSection = response.text.split('Ещё этого автора')[1] || '';
  assert.ok(!/href="\/knigi\/duna"/.test(similarSection), 'книга не должна быть похожей на себя');

  assert.ok(sameAuthor.book.id);
});

test('карточка: 404 на несуществующую книгу и на мусор в адресе', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  await makeBook(ctx, { slug: 'skrytaya', title: 'Скрытая', isPublished: false });

  for (const path of ['/knigi/net-takoy-knigi', '/knigi/skrytaya', '/knigi/%20', '/knigi/КНИГА']) {
    const response = await ctx.request.get(path);
    assert.equal(response.status, 404, `${path} должен отдавать 404`);
    // Внятная страница 404, а не пустой ответ: либо про книгу, либо общая
    assert.match(response.text, /Книга не найдена|Страница не найдена/);
  }
});

test('книгу может добавить только вошедший, поля проверяются', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const genre = await ctx.models.Genre.create({ name: 'Проза', slug: 'proza', sortOrder: 1 });

  // Гость — на страницу входа
  const guestPage = await ctx.request.get('/knigi/novaya');
  assert.equal(guestPage.status, 303);
  assert.equal(guestPage.headers.location, '/vhod');

  // Без CSRF-токена форма гостя отбивается защитой от подделки запросов
  const guestPost = await ctx.request.post('/knigi').type('form').send({ title: 'Книга', author: 'Автор' });
  assert.equal(guestPost.status, 403);
  assert.equal(await ctx.models.Book.count(), 0);

  const user = await ctx.createUser({ email: 'anna@example.com' });
  await ctx.login(user);

  const form = await ctx.agent.get('/knigi/novaya');
  assert.equal(form.status, 200);
  const token = extractCsrf(form.text);
  assert.ok(token);

  // Пустая форма — понятные ошибки, книга не создана
  const empty = await ctx.agent.post('/knigi').type('form').send({ _csrf: token, title: '', author: '' });
  assert.equal(empty.status, 422);
  assert.match(empty.text, /Введите название/);
  assert.match(empty.text, /Введите автора/);
  assert.equal(await ctx.models.Book.count(), 0);

  // Без жанра — тоже ошибка
  const noGenre = await ctx.agent.post('/knigi').type('form')
    .send({ _csrf: token, title: 'Книга', author: 'Автор' });
  assert.equal(noGenre.status, 422);
  assert.match(noGenre.text, /Выберите хотя бы один жанр/);

  // Успешное добавление — редирект на карточку
  const created = await ctx.agent.post('/knigi').type('form').send({
    _csrf: token,
    title: 'Новая книга',
    author: 'Новый автор',
    year: '2021',
    pages: '320',
    description: 'Короткое описание',
    genres: [String(genre.id)]
  });
  assert.equal(created.status, 303);
  assert.match(created.headers.location, /^\/knigi\/novyy-avtor-novaya-kniga$/);

  const book = await ctx.models.Book.findOne({ where: { slug: 'novyy-avtor-novaya-kniga' } });
  assert.ok(book, 'книга должна появиться в базе');
  assert.equal(book.title, 'Новая книга');
  assert.equal(book.year, 2021);
  assert.equal(book.createdByUserId, user.id);

  const page = await ctx.agent.get(created.headers.location);
  assert.equal(page.status, 200);
  assert.match(page.text, /Новая книга/);
});

test('добавление книги: дубли по названию получают разные адреса', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const genre = await ctx.models.Genre.create({ name: 'Проза', slug: 'proza', sortOrder: 1 });
  const user = await ctx.createUser({ email: 'anna2@example.com' });
  await ctx.login(user);

  const form = await ctx.agent.get('/knigi/novaya');
  const token = extractCsrf(form.text);

  const payload = {
    _csrf: token, title: 'Одинаковая', author: 'Автор',
    genres: [String(genre.id)]
  };

  const first = await ctx.agent.post('/knigi').type('form').send(payload);
  const second = await ctx.agent.post('/knigi').type('form').send(payload);

  assert.equal(first.status, 303);
  assert.equal(second.status, 303);
  assert.notEqual(first.headers.location, second.headers.location);
  assert.equal(await ctx.models.Book.count(), 2);
});

test('карточка книги показывает статус на полке и даёт отметить прогресс', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const { book } = await makeBook(ctx, { slug: 'duna', title: 'Дюна', pages: 400 });
  const user = await ctx.createUser({ email: 'anna5@example.com' });
  await ctx.login(user);

  const page = await ctx.agent.get('/knigi/duna');
  const token = extractCsrf(page.text);

  // Кнопки статуса на карточке ведут на маршруты полки и возвращают назад
  assert.match(page.text, /action="\/polka\/duna\/status"/);
  assert.match(page.text, /name="return_to" value="\/knigi\/duna"/);

  const put = await ctx.agent.post('/polka/duna/status').type('form')
    .send({ _csrf: token, status: 'reading', return_to: '/knigi/duna' });
  assert.equal(put.status, 303);
  assert.equal(put.headers.location, '/knigi/duna');

  const card = await ctx.agent.get('/knigi/duna');
  assert.match(card.text, /На полке: Читаю/);
  assert.match(card.text, /Убрать с полки/);
  assert.match(card.text, /Где вы остановились/, 'на карточке есть поле прогресса');

  const progress = await ctx.agent.post('/polka/duna/progress').type('form')
    .set('Accept', 'application/json')
    .send({ _csrf: token, pages: '100' });
  assert.equal(progress.body.percent, 25);

  const entry = await ctx.models.LibraryEntry.findOne({ where: { userId: user.id, bookId: book.id } });
  assert.equal(entry.progressPages, 100);

  const removed = await ctx.agent.post('/polka/duna/remove').type('form')
    .send({ _csrf: token, return_to: '/knigi/duna' });
  assert.equal(removed.status, 303);
  assert.equal(await ctx.models.LibraryEntry.count(), 0);
});

test('старые адреса полки не теряются: /knigi/:slug/polka ведёт на новый', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  await makeBook(ctx, { slug: 'duna', title: 'Дюна' });
  const user = await ctx.createUser({ email: 'anna6@example.com' });
  await ctx.login(user);
  const token = extractCsrf((await ctx.agent.get('/knigi/duna')).text);

  const old = await ctx.agent.post('/knigi/duna/polka').type('form')
    .send({ _csrf: token, status: 'read' });
  assert.equal(old.status, 307);
  assert.equal(old.headers.location, '/polka/duna/status');

  const follow = await ctx.agent.post('/polka/duna/status').type('form')
    .send({ _csrf: token, status: 'read' });
  assert.equal(follow.status, 303);
  assert.equal(await ctx.models.LibraryEntry.count(), 1);
});

test('скрытые книги не попадают ни в каталог, ни в поиск', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  await makeBook(ctx, { title: 'Видимая' });
  await makeBook(ctx, { title: 'Скрытая', isPublished: false });

  const list = await ctx.request.get('/knigi');
  assert.deepEqual(titlesFrom(list.text), ['Видимая']);

  const search = await ctx.request.get('/knigi').query({ q: 'скрытая' });
  assert.equal(titlesFrom(search.text).length, 0);
});

test('описание для поисковиков не длиннее 300 знаков', async (t) => {
  const { buildDescription } = require('../../src/routes/catalog');
  const long = buildDescription({
    title: 'Книга', author: 'Автор', year: 2020, rating: 4.5,
    description: 'Слово '.repeat(200)
  });
  assert.ok(long.length <= 300, `описание длиной ${long.length}`);
  assert.ok(long.startsWith('Книга — Автор'));

  const short = buildDescription({ title: 'Книга', author: 'Автор', description: '' });
  assert.ok(short.length <= 300);
  assert.match(short, /Книгоманах/);
});
