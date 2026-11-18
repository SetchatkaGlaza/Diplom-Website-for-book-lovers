'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, extractCsrf } = require('../support/app');
const { toRatingValue, toStars, splitSpoiler } = require('../../src/services/reviews');

/**
 * Оценки, рецензии, лайки и комментарии.
 * Главные проверки: средняя оценка сходится, спойлеры не утекают в HTML,
 * чужую рецензию нельзя удалить, лимиты длины работают.
 */

async function makeBook(ctx, data = {}) {
  return ctx.models.Book.create({
    slug: data.slug || `kniga-${Math.random().toString(36).slice(2, 10)}`,
    title: data.title || 'Тестовая книга',
    author: 'Автор',
    pages: 300,
    isPublished: true
  });
}

async function signIn(ctx, email) {
  const user = await ctx.createUser({ email: email || `reader${Math.random().toString(36).slice(2, 8)}@example.com` });
  await ctx.login(user);
  return user;
}

const LONG_BODY = 'Книга хорошая, читается быстро, герои живые. Рекомендую всем, кто любит спокойное чтение.';

test('оценка переводится туда и обратно, кривой шаг отклоняется', () => {
  assert.equal(toRatingValue(5), 10);
  assert.equal(toRatingValue(3.5), 7);
  assert.equal(toRatingValue(1), 2);
  assert.equal(toRatingValue(4.2), null);
  assert.equal(toRatingValue(0.5), null);
  assert.equal(toRatingValue(6), null);
  assert.equal(toRatingValue('abc'), null);

  assert.equal(toStars(7), 3.5);
  assert.equal(toStars(10), 5);
  assert.equal(toStars(null), 0);
});

test('спойлер режется так, что сюжет в открытом тексте не виден', () => {
  const body = 'Первая фраза без сюжета. А вот дальше идёт спойлер: главный герой погибает в финале.';
  const { intro, rest } = splitSpoiler(body);

  assert.ok(intro.length <= 75, `видимая часть слишком длинная: ${intro.length}`);
  assert.ok(!intro.includes('погибает'), 'спойлер попал в видимую часть');
  assert.ok(rest.includes('погибает'), 'продолжение должно остаться в скрытой части');

  // Короткий текст целиком остаётся видимым, скрывать нечего
  const short = splitSpoiler('Просто мнение.');
  assert.equal(short.intro, 'Просто мнение.');
  assert.equal(short.rest, '');

  // Пустой текст не ломает разбор
  assert.deepEqual(splitSpoiler(''), { intro: '', rest: '' });
});

test('рецензия: публикуется, средняя оценка книги сходится', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const book = await makeBook(ctx, { slug: 'duna', title: 'Дюна' });
  await signIn(ctx, 'anna7@example.com');

  const form = await ctx.agent.get('/knigi/duna/retsenziya');
  assert.equal(form.status, 200);
  const token = extractCsrf(form.text);

  const created = await ctx.agent.post('/knigi/duna/retsenziya').type('form').send({
    _csrf: token, rating: '4.5', title: 'Мощно', body: LONG_BODY
  });
  assert.equal(created.status, 303);
  assert.match(created.headers.location, /#retsenzii$/);

  const review = await ctx.models.Review.findOne({ where: { bookId: book.id } });
  assert.equal(review.rating, 9, '4.5 звезды = 9 в базе');
  assert.equal(review.title, 'Мощно');

  const fresh = await ctx.models.Book.findByPk(book.id);
  assert.equal(fresh.ratingsCount, 1);
  assert.equal(fresh.ratingsSum, 9);
  assert.equal(fresh.reviewsCount, 1);

  // Оценка видна на странице в звёздах
  const page = await ctx.request.get('/knigi/duna');
  assert.match(page.text, /4\.5 из 5/);
  assert.match(page.text, /Мощно/);

  // Оценка сама ставит книгу на полку в статус «прочитал»
  const entry = await ctx.models.LibraryEntry.findOne({ where: { bookId: book.id } });
  assert.equal(entry.status, 'read');
});

test('средняя оценка нескольких читателей считается правильно', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const book = await makeBook(ctx, { slug: 'duna', title: 'Дюна' });
  const ratings = [10, 8, 6]; // 5 + 4 + 3 = 4.0 в среднем
  for (let i = 0; i < ratings.length; i += 1) {
    const user = await ctx.createUser({ email: `reader-${i}-${Date.now()}@example.com` });
    await ctx.services.reviewService.save({
      userId: user.id, bookId: book.id, rating: ratings[i] / 2, body: LONG_BODY
    });
  }

  const fresh = await ctx.models.Book.findByPk(book.id);
  assert.equal(fresh.ratingsCount, 3);
  assert.equal(fresh.ratingsSum, 24);

  const page = await ctx.request.get('/knigi/duna');
  assert.match(page.text, /4 из 5/);
});

test('вторая рецензия заменяет первую, а не создаёт дубль', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const book = await makeBook(ctx, { slug: 'duna', title: 'Дюна' });
  await signIn(ctx, 'anna8@example.com');
  const token = extractCsrf((await ctx.agent.get('/knigi/duna/retsenziya')).text);

  await ctx.agent.post('/knigi/duna/retsenziya').type('form')
    .send({ _csrf: token, rating: '3', body: LONG_BODY });
  const updated = await ctx.agent.post('/knigi/duna/retsenziya').type('form')
    .send({ _csrf: token, rating: '5', title: 'Передумал', body: `${LONG_BODY} И ещё раз перечитал.` });

  assert.equal(updated.status, 303);
  assert.equal(await ctx.models.Review.count({ where: { bookId: book.id } }), 1);

  const review = await ctx.models.Review.findOne({ where: { bookId: book.id } });
  assert.equal(review.rating, 10);
  assert.equal(review.title, 'Передумал');

  const fresh = await ctx.models.Book.findByPk(book.id);
  assert.equal(fresh.ratingsSum, 10, 'средняя пересчитана после правки');
});

test('рецензия: короткий текст, кривая оценка и пустая форма дают ошибки', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  await makeBook(ctx, { slug: 'duna', title: 'Дюна' });
  await signIn(ctx, 'anna9@example.com');
  const token = extractCsrf((await ctx.agent.get('/knigi/duna/retsenziya')).text);

  const short = await ctx.agent.post('/knigi/duna/retsenziya').type('form')
    .send({ _csrf: token, rating: '4', body: 'Класс!' });
  assert.equal(short.status, 422);
  assert.match(short.text, /минимум 20 знаков/);

  const badRating = await ctx.agent.post('/knigi/duna/retsenziya').type('form')
    .send({ _csrf: token, rating: '4.3', body: LONG_BODY });
  assert.equal(badRating.status, 422);

  const noRating = await ctx.agent.post('/knigi/duna/retsenziya').type('form')
    .send({ _csrf: token, rating: '', body: LONG_BODY });
  assert.equal(noRating.status, 422);

  assert.equal(await ctx.models.Review.count(), 0, 'ничего не должно сохраниться');

  // Слишком длинный текст отклоняется
  const huge = await ctx.agent.post('/knigi/duna/retsenziya').type('form')
    .send({ _csrf: token, rating: '4', body: 'а'.repeat(20001) });
  assert.equal(huge.status, 422);
});

test('спойлер спрятан: продолжение не попадает в открытый HTML', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const book = await makeBook(ctx, { slug: 'duna', title: 'Дюна' });
  await signIn(ctx, 'anna10@example.com');
  const token = extractCsrf((await ctx.agent.get('/knigi/duna/retsenziya')).text);

  await ctx.agent.post('/knigi/duna/retsenziya').type('form').send({
    _csrf: token,
    rating: '5',
    hasSpoilers: '1',
    body: 'Книга про власть и пустыню. А в финале главный герой становится императором и теряет зрение.'
  });

  const page = await ctx.request.get('/knigi/duna');
  assert.match(page.text, /Дальше спойлеры — показать/);
  assert.match(page.text, /Книга про власть и пустыню/);

  // Продолжение лежит внутри <details> — до нажатия «показать» его не видно
  const details = page.text.slice(page.text.indexOf('<details class="spoiler"'));
  assert.ok(details.indexOf('теряет зрение') < details.indexOf('<form'), 'спойлер должен быть в скрытом блоке');
});

test('лайк: ставится, снимается, счётчик на рецензии совпадает', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const book = await makeBook(ctx, { slug: 'duna', title: 'Дюна' });
  const author = await ctx.createUser({ email: 'avtor@example.com' });
  const review = await ctx.models.Review.create({
    userId: author.id, bookId: book.id, rating: 8, body: LONG_BODY
  });

  await signIn(ctx, 'chitatel@example.com');
  const token = extractCsrf((await ctx.agent.get('/knigi/duna')).text);

  const liked = await ctx.agent.post(`/retsenziya/${review.id}/like`).type('form')
    .set('Accept', 'application/json')
    .send({ _csrf: token });
  assert.equal(liked.status, 200);
  assert.equal(liked.body.liked, true);
  assert.equal(liked.body.likesCount, 1);

  // Второй раз — снимаем
  const unliked = await ctx.agent.post(`/retsenziya/${review.id}/like`).type('form')
    .set('Accept', 'application/json')
    .send({ _csrf: token });
  assert.equal(unliked.body.liked, false);
  assert.equal(unliked.body.likesCount, 0);

  // Счётчик на самой рецензии тоже обновился
  const fresh = await ctx.models.Review.findByPk(review.id);
  assert.equal(fresh.likesCount, 0);
});

test('комментарии: добавляются, текст и счётчик сохраняются', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const book = await makeBook(ctx, { slug: 'duna', title: 'Дюна' });
  const author = await ctx.createUser({ email: 'avtor2@example.com' });
  const review = await ctx.models.Review.create({
    userId: author.id, bookId: book.id, rating: 8, body: LONG_BODY
  });

  await signIn(ctx, 'chitatel2@example.com');
  const token = extractCsrf((await ctx.agent.get('/knigi/duna')).text);

  const added = await ctx.agent.post(`/retsenziya/${review.id}/komment`).type('form')
    .send({ _csrf: token, body: 'Согласен с каждым словом' });
  assert.equal(added.status, 303);

  const comments = await ctx.models.ReviewComment.findAll({ where: { reviewId: review.id } });
  assert.equal(comments.length, 1);
  assert.equal(comments[0].body, 'Согласен с каждым словом');

  const fresh = await ctx.models.Review.findByPk(review.id);
  assert.equal(fresh.commentsCount, 1);

  // Слишком короткий комментарий отклоняется
  const short = await ctx.agent.post(`/retsenziya/${review.id}/komment`).type('form')
    .send({ _csrf: token, body: 'а' });
  assert.equal(short.status, 303);
  assert.equal(await ctx.models.ReviewComment.count({ where: { reviewId: review.id } }), 1);

  // Комментарий виден на странице книги
  const page = await ctx.request.get('/knigi/duna');
  assert.match(page.text, /Согласен с каждым словом/);
});

test('удалить рецензию может автор, а чужую — нельзя', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const book = await makeBook(ctx, { slug: 'duna', title: 'Дюна' });
  const author = await ctx.createUser({ email: 'avtor3@example.com' });
  const review = await ctx.models.Review.create({
    userId: author.id, bookId: book.id, rating: 8, body: LONG_BODY
  });
  await book.update({ ratingsCount: 1, ratingsSum: 8, reviewsCount: 1 });

  // Чужой человек пробует удалить — отказ
  await signIn(ctx, 'chuzhoy@example.com');
  let token = extractCsrf((await ctx.agent.get('/knigi/duna')).text);
  const foreign = await ctx.agent.post(`/retsenziya/${review.id}/udalit`).type('form').send({ _csrf: token });
  assert.equal(foreign.status, 403);
  assert.equal(await ctx.models.Review.count(), 1, 'чужая рецензия осталась');

  // Автор удаляет — получается
  const ctx2 = await createTestApp();
  t.after(() => ctx2.close());
  const book2 = await ctx2.models.Book.create({ slug: 'duna', title: 'Дюна', author: 'А', isPublished: true });
  const author2 = await ctx2.createUser({ email: 'avtor4@example.com' });
  await ctx2.login(author2);
  const own = await ctx2.models.Review.create({ userId: author2.id, bookId: book2.id, rating: 9, body: LONG_BODY });
  await book2.update({ ratingsCount: 1, ratingsSum: 9, reviewsCount: 1 });

  token = extractCsrf((await ctx2.agent.get('/knigi/duna')).text);
  const removed = await ctx2.agent.post(`/retsenziya/${own.id}/udalit`).type('form').send({ _csrf: token });
  assert.equal(removed.status, 303);
  assert.equal(await ctx2.models.Review.count(), 0);

  const fresh = await ctx2.models.Book.findByPk(book2.id);
  assert.equal(fresh.ratingsCount, 0, 'средняя обнулилась после удаления');
  assert.equal(fresh.ratingsSum, 0);
});

test('рецензии листаются по 10, кривая страница не ломает', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const book = await makeBook(ctx, { slug: 'duna', title: 'Дюна' });
  for (let i = 1; i <= 13; i += 1) {
    const user = await ctx.createUser({ email: `user-${i}-${Date.now()}@example.com` });
    await ctx.models.Review.create({
      userId: user.id, bookId: book.id, rating: 8,
      title: `Рецензия номер ${i}`, body: `${LONG_BODY} Номер ${i}.`
    });
  }

  const first = await ctx.request.get('/knigi/duna');
  assert.match(first.text, /Страница 1 из 2/);
  const shown = (first.text.match(/class="review"/g) || []).length;
  assert.equal(shown, 10);

  const second = await ctx.request.get('/knigi/duna').query({ stranitsa: 2 });
  const shownSecond = (second.text.match(/class="review"/g) || []).length;
  assert.equal(shownSecond, 3);

  for (const page of ['0', '-2', 'abc', '999']) {
    const response = await ctx.request.get('/knigi/duna').query({ stranitsa: page });
    assert.equal(response.status, 200, `страница «${page}» сломала карточку`);
  }
});

test('гость не может писать рецензии, ставить лайки и комментировать', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const book = await makeBook(ctx, { slug: 'duna', title: 'Дюна' });
  const author = await ctx.createUser({ email: 'avtor5@example.com' });
  const review = await ctx.models.Review.create({
    userId: author.id, bookId: book.id, rating: 8, body: LONG_BODY
  });

  const form = await ctx.request.get('/knigi/duna/retsenziya');
  assert.equal(form.status, 303);
  assert.equal(form.headers.location, '/vhod');

  const like = await ctx.request.post(`/retsenziya/${review.id}/like`).type('form').send({});
  assert.equal(like.status, 403);
  assert.equal(await ctx.models.ReviewLike.count(), 0);

  // Гость видит рецензии, но кнопки неактивны
  const page = await ctx.request.get('/knigi/duna');
  assert.match(page.text, /class="review"/);
  assert.match(page.text, /disabled/);
});

test('скрытая модератором рецензия не влияет на среднюю оценку', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const book = await makeBook(ctx, { slug: 'duna', title: 'Дюна' });
  const good = await ctx.createUser({ email: 'horoshaya@example.com' });
  const bad = await ctx.createUser({ email: 'skrytaya@example.com' });

  await ctx.services.reviewService.save({ userId: good.id, bookId: book.id, rating: 5, body: LONG_BODY });
  await ctx.services.reviewService.save({ userId: bad.id, bookId: book.id, rating: 1, body: LONG_BODY });

  // Модератор скрывает вторую
  const hidden = await ctx.models.Review.findOne({ where: { userId: bad.id } });
  await hidden.update({ state: 'hidden' });
  await ctx.services.reviewService.recountBook(book.id);

  const fresh = await ctx.models.Book.findByPk(book.id);
  assert.equal(fresh.ratingsCount, 1);
  assert.equal(fresh.ratingsSum, 10);

  const page = await ctx.request.get('/knigi/duna');
  assert.match(page.text, /5 из 5/);
  assert.ok(!page.text.includes('skrytaya@example.com'));
});
