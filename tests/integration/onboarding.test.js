'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createTestApp, extractCsrf } = require('../support/app');
const {
  parseCsv, normalizeTitle, mapRating, mapShelf, parseDate
} = require('../../src/services/import');

/**
 * Онбординг и импорт.
 *
 * Ключевые критерии плана:
 *  - файл на 50 строк сопоставляется минимум на 90%;
 *  - битый файл даёт понятную ошибку и 422, а не 500.
 */

async function signIn(ctx, email, name) {
  const user = await ctx.createUser({ email, name });
  const agent = request.agent(ctx.app);
  await ctx.login(user, 'reader2026', agent);
  return { user, agent };
}

async function csrf(agent, path) {
  const page = await agent.get(path);
  return extractCsrf(page.text);
}

/** 50 книг: 46 точных совпадений, 2 с «ё» и лишними кавычками, 2 чужих. */
async function seedCatalog(ctx) {
  const books = [];
  for (let i = 1; i <= 48; i += 1) {
    books.push(await ctx.models.Book.create({
      slug: `kniga-${i}`,
      title: i <= 46 ? `Книга номер ${i}` : `Книга номер ${i} ёжика`,
      author: i <= 46 ? 'Автор Тестов' : 'Автор Ёжиков',
      pages: 100 + i,
      isPublished: true
    }));
  }
  return books;
}

function buildCsv(count = 50) {
  const lines = ['Title,Author,My Rating,Exclusive Shelf,Number of Pages'];
  for (let i = 1; i <= 46; i += 1) {
    lines.push(`"Книга номер ${i}","Автор Тестов",${(i % 5) + 1},read,${100 + i}`);
  }
  // Эти две должны совпасть после нормализации: кавычки, ё, регистр
  lines.push('«Книга номер 47 ёжика»,Автор Ёжиков,5,read,147');
  lines.push('книга номер 48 ЕЖИКА,автор ежиков,4,to-read,148');
  // Чужие книги
  lines.push('Нет такой книги,Неизвестный,3,read,100');
  lines.push('Тоже нет,Кто-то,2,want,90');

  return { csv: lines.join('\n'), count };
}

test('разбор CSV: кавычки, точка с запятой, BOM', () => {
  const simple = parseCsv('Title,Author\n"Дюна, или Песчаная",Герберт\n');
  assert.equal(simple.rows[1][0], 'Дюна, или Песчаная');

  const semicolons = parseCsv('Название;Автор\nСолярис;Лем');
  assert.equal(semicolons.delimiter, ';');
  assert.equal(semicolons.rows[1][1], 'Лем');

  const bom = parseCsv('\uFEFFНазвание,Автор\nСолярис,Лем');
  assert.equal(bom.rows[0][0], 'Название');

  // Кавычка внутри значения экранируется удвоением
  const quotes = parseCsv('Title\n"Он сказал ""привет"""');
  assert.equal(quotes.rows[1][0], 'Он сказал "привет"');

  // Перевод строки внутри кавычек не ломает строку
  const multiline = parseCsv('Title,Review\n"Книга","Первая строка\nвторая строка"');
  assert.equal(multiline.rows[1][1], 'Первая строка\nвторая строка');
});

test('нормализация и словари оценок/полок', () => {
  assert.equal(normalizeTitle('«Книга» — Ёжика!'), 'книга ежика');
  assert.equal(normalizeTitle('  Дюна  '), 'дюна');

  assert.equal(mapRating('5'), 10);
  assert.equal(mapRating('4.5'), 9);
  assert.equal(mapRating('3,5'), 7);
  assert.equal(mapRating('10'), 10);
  assert.equal(mapRating(''), null);

  assert.equal(mapShelf('read'), 'read');
  assert.equal(mapShelf('currently reading'), 'reading');
  assert.equal(mapShelf('to-read'), 'want');
  assert.equal(mapShelf('прочитано'), 'read');

  assert.equal(parseDate('2026/03/01').toISOString().slice(0, 10), '2026-03-01');
  assert.equal(parseDate('01.03.2026').toISOString().slice(0, 10), '2026-03-01');
  assert.equal(parseDate('мусор'), null);
});

test('файл на 50 строк сопоставляется минимум на 90%', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  await seedCatalog(ctx);
  const { user } = await signIn(ctx, 'anna@example.com', 'Анна');
  const { csv } = buildCsv();

  const result = await ctx.services.importService.run({ userId: user.id, text: csv });

  assert.equal(result.total, 50);
  assert.equal(result.matched, 48, 'все 48 книг каталога должны найтись');
  assert.ok(result.matched / result.total >= 0.9, `сопоставлено ${result.matched} из ${result.total} — меньше 90%`);
  assert.equal(result.added, 48);
  assert.equal(result.notFound, 2);
  assert.deepEqual(result.reasons, [{ reason: 'Нет в каталоге', count: 2 }]);

  // Записи действительно на полке
  assert.equal(await ctx.models.LibraryEntry.count({ where: { userId: user.id } }), 48);

  const read = await ctx.models.LibraryEntry.findAll({ where: { userId: user.id, status: 'read' } });
  assert.equal(read.length, 47, 'сорок семь прочитанных');
  assert.ok(read.every((entry) => entry.finishedAt === null || entry.finishedAt instanceof Date));
});

test('повторный импорт обновляет, а не дублирует', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  await seedCatalog(ctx);
  const { user } = await signIn(ctx, 'anna@example.com', 'Анна');
  const { csv } = buildCsv();

  await ctx.services.importService.run({ userId: user.id, text: csv });
  const second = await ctx.services.importService.run({ userId: user.id, text: csv });

  assert.equal(second.added, 0, 'ничего не добавилось повторно');
  assert.equal(second.updated, 48);
  assert.equal(await ctx.models.LibraryEntry.count({ where: { userId: user.id } }), 48);
});

test('битые файлы дают понятную ошибку, а не 500', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const { user, agent } = await signIn(ctx, 'anna@example.com', 'Анна');

  // Пустой файл
  const empty = await ctx.services.importService.run({ userId: user.id, text: '' });
  assert.match(empty.error, /Файл пустой/);

  // Только заголовок
  const headerOnly = await ctx.services.importService.run({ userId: user.id, text: 'Title,Author\n' });
  assert.match(headerOnly.error, /ни одной книги/);

  // Слишком большой
  const huge = await ctx.services.importService.run({ userId: user.id, text: 'a'.repeat(6 * 1024 * 1024) });
  assert.match(huge.error, /больше 5 МБ/);

  // Через HTTP: 422 и текст ошибки, без падения
  const token = await csrf(agent, '/import');
  const response = await agent.post('/import').type('form')
    .send({ _csrf: token, file: '   ' });
  assert.equal(response.status, 422);
  assert.match(response.text, /Прикрепите CSV-файл/);

  // Мусор из нулевых байтов и кавычек не роняет сервер
  const garbage = await agent.post('/import').type('form')
    .send({ _csrf: token, file: '\u0000\u0001"""\u0002,,,\n\n' });
  assert.ok([200, 422].includes(garbage.status), `ожидали 200 или 422, получили ${garbage.status}`);
});

test('проверка перед импортом ничего не записывает', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  await seedCatalog(ctx);
  const { user, agent } = await signIn(ctx, 'anna@example.com', 'Анна');
  const { csv } = buildCsv();

  const token = await csrf(agent, '/import');
  const response = await agent.post('/import').type('form')
    .send({ _csrf: token, file: csv, dryRun: '1' });

  assert.equal(response.status, 200);
  assert.match(response.text, /Строк в файле/);
  assert.equal(await ctx.models.LibraryEntry.count({ where: { userId: user.id } }), 0, 'ничего не записали');
});

test('экспорт отдаёт CSV, который можно импортировать обратно', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const book = await ctx.models.Book.create({
    slug: 'duna', title: 'Дюна', author: 'Фрэнк Герберт', pages: 600, isPublished: true
  });
  const { user, agent } = await signIn(ctx, 'anna@example.com', 'Анна');
  await ctx.models.LibraryEntry.create({ userId: user.id, bookId: book.id, status: 'read' });
  await ctx.models.Review.create({
    userId: user.id, bookId: book.id, rating: 9, body: 'Очень длинная рецензия для проверки экспорта.'
  });

  const response = await agent.get('/eksport');
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /text\/csv/);
  assert.match(response.headers['content-disposition'], /knigomany-polka\.csv/);
  assert.match(response.text, /Дюна/);
  assert.match(response.text, /прочитано/);

  // Импорт собственного экспорта возвращает те же данные
  const back = await ctx.services.importService.run({ userId: user.id, text: response.text });
  assert.equal(back.error, undefined);
  assert.equal(back.updated, 1);
  assert.equal(await ctx.models.LibraryEntry.count({ where: { userId: user.id } }), 1);
});

test('рецензия из файла переносится и не дублируется', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const book = await ctx.models.Book.create({
    slug: 'solaris', title: 'Солярис', author: 'Станислав Лем', pages: 300, isPublished: true
  });
  const { user } = await signIn(ctx, 'anna@example.com', 'Анна');

  const csv = 'Title,Author,My Rating,Exclusive Shelf,My Review\n'
    + 'Солярис,Станислав Лем,5,read,"Океан думает, и это самое страшное в книге."';

  await ctx.services.importService.run({ userId: user.id, text: csv });
  await ctx.services.importService.run({ userId: user.id, text: csv });

  const reviews = await ctx.models.Review.findAll({ where: { userId: user.id, bookId: book.id } });
  assert.equal(reviews.length, 1, 'рецензия одна');
  assert.equal(reviews[0].rating, 10);
  assert.match(reviews[0].body, /Океан думает/);
});

test('онбординг: жанры → книги → цель', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const fantasy = await ctx.models.Genre.create({ slug: 'fantastika', name: 'Фантастика' });
  const book = await ctx.models.Book.create({
    slug: 'duna', title: 'Дюна', author: 'Фрэнк Герберт', pages: 600, isPublished: true
  });
  await book.addGenre(fantasy);

  const { user, agent } = await signIn(ctx, 'anna@example.com', 'Анна');

  // Шаг 1
  const startPage = await agent.get('/start');
  assert.equal(startPage.status, 200);
  assert.match(startPage.text, /Что вам нравится/);

  const token = extractCsrf(startPage.text);
  const step1 = await agent.post('/start/zhanry').type('form')
    .send({ _csrf: token, zhanry: [String(fantasy.id)] });
  assert.equal(step1.status, 303);
  assert.match(step1.headers.location, /shag=knigi/);

  // Шаг 2: подсказки по жанру
  const step2Page = await agent.get(step1.headers.location);
  assert.match(step2Page.text, /Дюна/);
  const token2 = extractCsrf(step2Page.text);

  const step2 = await agent.post('/start/knigi').type('form')
    .send({ _csrf: token2, bookIds: [String(book.id)], zhanry: String(fantasy.id) });
  assert.equal(step2.status, 303);
  assert.match(step2.headers.location, /shag=tsel/);
  assert.equal(await ctx.models.LibraryEntry.count({ where: { userId: user.id, status: 'want' } }), 1);

  // Шаг 3: цель
  const token3 = await csrf(agent, '/start?shag=tsel');
  const step3 = await agent.post('/start/tsel').type('form').send({ _csrf: token3, target: '24' });
  assert.equal(step3.status, 303);
  assert.equal(step3.headers.location, '/polka');

  const goal = await ctx.models.ReadingGoal.findOne({ where: { userId: user.id } });
  assert.equal(goal.targetBooks, 24);
});

test('онбординг: без жанра и с целью вне диапазона — 422 с текстом', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const { agent } = await signIn(ctx, 'anna@example.com', 'Анна');

  const token = await csrf(agent, '/start');
  const noGenre = await agent.post('/start/zhanry').type('form').send({ _csrf: token });
  assert.equal(noGenre.status, 422);
  assert.match(noGenre.text, /Выберите хотя бы один жанр/);

  const token2 = await csrf(agent, '/start?shag=tsel');
  const badGoal = await agent.post('/start/tsel').type('form').send({ _csrf: token2, target: '5000' });
  assert.equal(badGoal.status, 422);
  assert.match(badGoal.text, /допустимый диапазон/);
});

test('пустая полка показывает подсказки, а не пустоту', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  await ctx.models.Book.create({
    slug: 'duna', title: 'Дюна для подсказки', author: 'Герберт', pages: 600, isPublished: true
  });
  const { agent } = await signIn(ctx, 'anna@example.com', 'Анна');

  const shelf = await agent.get('/polka');
  assert.equal(shelf.status, 200);
  assert.match(shelf.text, /Полка ждёт первую книгу/);
  assert.match(shelf.text, /С чего начать/);
  assert.match(shelf.text, /Дюна для подсказки/);
});

test('гость не попадает ни в онбординг, ни в импорт', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  for (const path of ['/start', '/import', '/eksport']) {
    const response = await ctx.request.get(path);
    assert.equal(response.status, 303, `${path} должен уводить на вход`);
  }
});
