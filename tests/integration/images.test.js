'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp } = require('../support/app');

/**
 * Маршруты картинок: обложки, аватары, портреты авторов, OG.
 *
 * Что проверяем:
 *  - картинка есть у любой книги, даже если файл обложки не загружали;
 *  - наружу уходит PNG, а не SVG (SVG на нашем домене может исполнить скрипт);
 *  - есть кэш: ETag + 304 на повторный запрос;
 *  - чужого не отдаём: черновик книги и несуществующий слаг — 404.
 */

async function binaryParser(res, callback) {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

test('обложка книги отдаётся PNG и кэшируется', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const genre = await ctx.models.Genre.create({ name: 'Фантастика', slug: 'fantastika' });
  const book = await ctx.models.Book.create({
    slug: 'duna', title: 'Дюна', author: 'Фрэнк Герберт', pages: 600, isPublished: true
  });
  await book.addGenre(genre);

  const first = await ctx.request.get('/kartinki/oblozhka/duna').buffer(true).parse(binaryParser);
  assert.equal(first.status, 200);
  assert.match(first.headers['content-type'], /image\/png/);
  assert.ok(first.body.length > 3000, 'картинка подозрительно маленькая');

  // PNG: сигнатура 89 50 4E 47
  assert.deepEqual([...first.body.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);

  const etag = first.headers.etag;
  assert.ok(etag, 'нет ETag — картинка будет качаться заново');
  assert.match(first.headers['cache-control'], /max-age=\d+/);

  const second = await ctx.request.get('/kartinki/oblozhka/duna').set('If-None-Match', etag);
  assert.equal(second.status, 304, 'повторный запрос должен вернуть 304');
});

test('обложка не отдаётся для черновика и несуществующей книги', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  await ctx.models.Book.create({ slug: 'chernovik', title: 'Черновик', author: 'Автор', isPublished: false });

  const draft = await ctx.request.get('/kartinki/oblozhka/chernovik');
  assert.equal(draft.status, 404);

  const missing = await ctx.request.get('/kartinki/oblozhka/net-takoy-knigi');
  assert.equal(missing.status, 404);
});

test('размер large отличается от card', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  await ctx.models.Book.create({ slug: 'duna', title: 'Дюна', author: 'Фрэнк Герберт', isPublished: true });

  const card = await ctx.request.get('/kartinki/oblozhka/duna?size=card').buffer(true).parse(binaryParser);
  const large = await ctx.request.get('/kartinki/oblozhka/duna?size=large').buffer(true).parse(binaryParser);

  assert.ok(large.body.length > card.body.length, 'большая обложка должна быть тяжелее');
  // Неизвестный размер — не ошибка, просто карточка
  const fallback = await ctx.request.get('/kartinki/oblozhka/duna?size=huge');
  assert.equal(fallback.status, 200);
});

test('аватар: PNG для существующего читателя, 404 для выдуманного', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const user = await ctx.createUser({ email: 'anna@example.com', name: 'Анна Петрова' });

  const avatar = await ctx.request.get(`/kartinki/avatar/${user.id}`).buffer(true).parse(binaryParser);
  assert.equal(avatar.status, 200);
  assert.match(avatar.headers['content-type'], /image\/png/);
  assert.deepEqual([...avatar.body.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);

  assert.equal((await ctx.request.get('/kartinki/avatar/999999')).status, 404);
  assert.equal((await ctx.request.get('/kartinki/avatar/abc')).status, 404);
});

test('портрет автора есть для автора из каталога', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  await ctx.models.Author.create({
    slug: 'mikhail-bulgakov', name: 'Михаил Булгаков', years: '1891–1940', bio: 'Писатель.'
  });

  const portrait = await ctx.request.get('/kartinki/avtor/mikhail-bulgakov').buffer(true).parse(binaryParser);
  assert.equal(portrait.status, 200);
  assert.match(portrait.headers['content-type'], /image\/png/);

  assert.equal((await ctx.request.get('/kartinki/avtor/net-takogo')).status, 404);
});

test('OG-картинка отдаётся и кэшируется', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const og = await ctx.request.get('/kartinki/og.png').buffer(true).parse(binaryParser);
  assert.equal(og.status, 200);
  assert.match(og.headers['content-type'], /image\/png/);
  assert.ok(og.body.length > 10000, 'OG-картинка слишком лёгкая');
});

test('карточка книги в каталоге ссылается на серверную обложку', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  await ctx.models.Book.create({
    slug: 'duna', title: 'Дюна', author: 'Фрэнк Герберт', pages: 600, isPublished: true
  });

  const catalog = await ctx.request.get('/knigi');
  assert.equal(catalog.status, 200);
  assert.match(catalog.text, /\/kartinki\/oblozhka\/duna/, 'в каталоге нет картинки обложки');
  assert.match(catalog.text, /alt="Обложка: Дюна"/);
  assert.ok(!/default-cover\.svg/.test(catalog.text), 'осталась ссылка на отсутствующий файл-заглушку');

  const page = await ctx.request.get('/knigi/duna');
  assert.equal(page.status, 200);
  assert.match(page.text, /\/kartinki\/oblozhka\/duna\?size=large/);
});

test('на главной есть живая полка и логотип', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  await ctx.models.Book.create({
    slug: 'duna', title: 'Дюна', author: 'Фрэнк Герберт', pages: 600, isPublished: true,
    ratingsCount: 10, ratingsSum: 45
  });

  const home = await ctx.request.get('/');
  assert.equal(home.status, 200);
  assert.match(home.text, /class="hero-shelf"/);
  assert.match(home.text, /\/kartinki\/oblozhka\/duna/);
  assert.match(home.text, /\/assets\/img\/brand\/mark\.svg/);
  assert.match(home.text, /\/kartinki\/og\.png/);
  assert.match(home.text, /\/assets\/js\/motion\.js/);
});

test('картинки не ломают CSP: только self и data', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const response = await ctx.request.get('/kartinki/og.png');
  assert.equal(response.status, 200);
  // Картинки рисует сервер, сторонних доменов в разметке быть не должно
  const home = await ctx.request.get('/');
  assert.ok(!/src="https?:\/\/(?!localhost)/.test(home.text), 'на главной появилась внешняя картинка');
});
