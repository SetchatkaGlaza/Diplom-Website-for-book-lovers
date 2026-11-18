'use strict';

/**
 * Наполнение: контент, подборки, авторы.
 *
 * Здесь проверяется не «страница отдаёт 200», а то, что решает судьбу каталога:
 * файлы контента валидны, битые данные не доезжают до базы, повторная
 * загрузка ничего не дублирует, а страницы подборок и авторов ведут туда,
 * куда обещают.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createTestApp } = require('../support/app');
const { loadContent } = require('../../src/config/content');
const { validateContent, validateBooks, validateCollections, LIMITS } = require('../../src/lib/content');
const { GENRES } = require('../../src/db/seed');

const CONTENT_DIR = path.join(__dirname, '..', '..', 'content');

test('контент в репозитории валиден и достаточен для запуска', () => {
  const content = loadContent({ dir: CONTENT_DIR });
  const result = validateContent(content, { genres: GENRES });

  assert.deepEqual(result.errors, [], `ошибки контента:\n${result.errors.join('\n')}`);
  assert.deepEqual(result.warnings, [], `предупреждения контента:\n${result.warnings.join('\n')}`);

  assert.ok(result.books.length >= 300, `книг должно быть не меньше 300, а не ${result.books.length}`);
  assert.ok(result.collections.length >= 20, `подборок должно быть 20+, а не ${result.collections.length}`);
  assert.ok(result.authors.length >= 10, `авторов должно быть 10+, а не ${result.authors.length}`);

  // У каждого жанра есть книги, иначе пустая кнопка фильтра
  const usedGenres = new Set(result.books.map((book) => book.genre));
  GENRES.forEach((genre) => {
    assert.ok(usedGenres.has(genre), `в жанре «${genre}» нет ни одной книги`);
  });

  // Описания — свои, не заглушки, и в разумных пределах
  result.books.forEach((book) => {
    assert.ok(book.description.length >= 80, `${book.title}: описание короче 80 символов`);
    assert.ok(book.description.length <= 1200, `${book.title}: описание длиннее 1200 символов`);
    assert.ok(!/демонстрационн|заглушк|todo|lorem/i.test(book.description), `${book.title}: описание-заглушка`);
  });
});

test('в файлах контента нет дублей книг, подборок и авторов', () => {
  const content = loadContent({ dir: CONTENT_DIR });
  const result = validateContent(content, { genres: GENRES });

  const bookSlugs = result.books.map((book) => book.slug);
  assert.equal(new Set(bookSlugs).size, bookSlugs.length, 'слаги книг должны быть уникальны');

  const collectionSlugs = result.collections.map((item) => item.slug);
  assert.equal(new Set(collectionSlugs).size, collectionSlugs.length, 'слаги подборок уникальны');

  const authorSlugs = result.authors.map((item) => item.slug);
  assert.equal(new Set(authorSlugs).size, authorSlugs.length, 'слаги авторов уникальны');
});

test('проверка книг: битые данные не проходят', () => {
  const { errors, warnings } = validateBooks([
    { title: '', author: '', description: '' },
    { title: 'Книга', author: 'Автор', description: 'коротко', genre: 'Жанр-которого-нет', year: 3026, pages: 2 },
    { title: 'Дюна', author: 'Фрэнк Герберт', description: 'Описание в сто символов '.repeat(4), genre: 'Фантастика' },
    { title: 'Дюна', author: 'Фрэнк Герберт', description: 'Описание в сто символов '.repeat(4), genre: 'Фантастика' }
  ], { genres: ['Фантастика'] });

  const text = errors.join('\n');
  assert.match(text, /название короче/);
  assert.match(text, /не указан автор/);
  assert.match(text, /пустое описание/);
  assert.match(text, /неизвестный жанр/);
  assert.match(text, /год издания/);
  assert.match(text, /число страниц/);
  assert.match(text, /уже занят/, 'две одинаковые книги дают ошибку, а не дубль');
  // Короткое описание — предупреждение, а не отказ: книга выйдет, но её надо доработать
  assert.match(warnings.join('\n'), /описание короче/);
});

test('проверка подборок: нельзя собрать список из несуществующих книг', () => {
  const { errors } = validateCollections([
    { title: 'Подборка', description: 'Нормальное описание', books: ['kniga-est', 'knigi-net'] },
    { title: 'Ещё одна', description: 'Описание', books: ['kniga-est'] }
  ], { bookSlugs: ['kniga-est'] });

  const text = errors.join('\n');
  assert.match(text, /knigi-net.*не найдена/);
  assert.match(text, /меньше трёх книг/);
  assert.ok(LIMITS.quoteMax > 0);
});

test('загрузка контента: повторный запуск не создаёт дубли', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const content = loadContent({ dir: CONTENT_DIR });
  const validated = validateContent(content, { genres: GENRES });

  // Для скорости берём срез, но с настоящими связями подборок
  const slice = {
    books: validated.books.slice(0, 12),
    collections: [{
      slug: 'test-podborka',
      title: 'Тестовая подборка',
      description: 'Проверяем загрузку и связи.',
      books: validated.books.slice(0, 5).map((book) => book.slug)
    }],
    authors: [{ slug: 'test-avtor', name: validated.books[0].author, years: '', bio: 'Тестовая биография автора.' }]
  };

  const first = await ctx.services.contentService.apply(slice);
  assert.equal(first.books.created, 12);
  assert.equal(first.collections.created, 1);
  assert.equal(first.collections.books, 5);
  assert.equal(first.authors.created, 1);

  const second = await ctx.services.contentService.apply(slice);
  assert.equal(second.books.created, 0, 'второй запуск не должен создавать книги');
  assert.equal(second.books.skipped, 12);
  assert.equal(second.authors.created, 0);

  assert.equal(await ctx.models.Book.count(), 12);
  assert.equal(await ctx.models.Collection.count(), 1);
  assert.equal(await ctx.models.CollectionBook.count(), 5);

  // С обновлением существующие книги правятся, а не дублируются
  const changed = {
    ...slice,
    books: [{ ...slice.books[0], description: 'Новое описание книги, достаточно длинное для проверки обновления.' }]
  };
  const third = await ctx.services.contentService.apply(changed, { update: true });
  assert.equal(third.books.updated, 1);
  assert.equal(await ctx.models.Book.count(), 12);

  const book = await ctx.models.Book.findOne({ where: { slug: slice.books[0].slug } });
  assert.match(book.description, /Новое описание/);
});

test('загрузка связывает книги с жанрами, а не оставляет их без рубрики', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  await ctx.services.contentService.apply({
    books: [{
      slug: 'test-zhanr-kniga',
      title: 'Книга с жанром',
      author: 'Тестовый Автор',
      description: 'Описание, которое проходит проверку длины и не содержит заглушек.',
      genre: 'Фантастика',
      year: 2020,
      pages: 300
    }],
    collections: [],
    authors: []
  });

  const book = await ctx.models.Book.findOne({ where: { slug: 'test-zhanr-kniga' } });
  const links = await ctx.models.BookGenre.findAll({ where: { bookId: book.id } });
  assert.equal(links.length, 1);

  const genre = await ctx.models.Genre.findByPk(links[0].genreId);
  assert.equal(genre.name, 'Фантастика');
});

test('страница подборок и одна подборка открываются гостю', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const book = await ctx.models.Book.create({
    slug: 'duna-dlya-podborki', title: 'Дюна', author: 'Фрэнк Герберт',
    year: 1965, pages: 704, description: 'Планета, песок и пряность.', cover: 'covers/demo-1.svg'
  });
  const collection = await ctx.models.Collection.create({
    slug: 'dlya-nachinayushchih', title: 'Для начинающих', description: 'Пять книг, с которых легко начать.'
  });
  await ctx.models.CollectionBook.create({ collectionId: collection.id, bookId: book.id, position: 0 });

  const list = await ctx.request.get('/podborki');
  assert.equal(list.status, 200);
  assert.match(list.text, /Для начинающих/);

  const page = await ctx.request.get('/podborki/dlya-nachinayushchih');
  assert.equal(page.status, 200);
  assert.match(page.text, /Дюна/, 'книга должна быть в подборке');
  assert.match(page.text, /Пять книг, с которых легко начать/);

  const missing = await ctx.request.get('/podborki/net-takoy');
  assert.equal(missing.status, 404);
});

test('страница автора показывает все его книги и открыта без входа', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  await ctx.models.Book.create({
    slug: 'master-i-margarita', title: 'Мастер и Маргарита', author: 'Михаил Булгаков',
    year: 1967, pages: 480, description: 'Роман о дьяволе в Москве.', cover: 'covers/demo-1.svg'
  });
  await ctx.models.Book.create({
    slug: 'sabachie-serdce', title: 'Собачье сердце', author: 'Михаил Булгаков',
    year: 1925, pages: 160, description: 'Повесть о профессоре и собаке.', cover: 'covers/demo-2.svg'
  });
  await ctx.models.Author.create({
    slug: 'mihail-bulgakov', name: 'Михаил Булгаков', years: '1891–1940', bio: 'Врач, писатель, драматург.'
  });

  const authors = await ctx.request.get('/avtory');
  assert.equal(authors.status, 200);
  assert.match(authors.text, /Михаил Булгаков/);

  const page = await ctx.request.get('/avtory/mihail-bulgakov');
  assert.equal(page.status, 200);
  assert.match(page.text, /Мастер и Маргарита/);
  assert.match(page.text, /Собачье сердце/);
  assert.match(page.text, /1891–1940/);

  assert.equal((await ctx.request.get('/avtory/kto-to-drugoy')).status, 404);
});

test('карточка книги показывает подборки, в которые она входит', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const book = await ctx.models.Book.create({
    slug: 'duna-v-podborke', title: 'Дюна', author: 'Фрэнк Герберт',
    year: 1965, pages: 704, description: 'Планета, песок и пряность.', cover: 'covers/demo-1.svg'
  });
  const collection = await ctx.models.Collection.create({
    slug: 'fантастика-без-космоса'.replace(/[^a-z0-9-]/g, ''), title: 'Фантастика без космоса', description: 'Для тех, кто не любит космос.'
  });
  await ctx.models.CollectionBook.create({ collectionId: collection.id, bookId: book.id, position: 0 });

  const page = await ctx.request.get('/knigi/duna-v-podborke');
  assert.equal(page.status, 200);
  assert.match(page.text, /в подборках:/);
  assert.match(page.text, /Фантастика без космоса/);
});

test('sitemap включает подборки и авторов', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  await ctx.models.Collection.create({ slug: 'knigi-na-noch', title: 'На ночь', description: 'Спокойное чтение.' });
  await ctx.models.Author.create({ slug: 'anton-chehov', name: 'Антон Чехов', bio: 'Врач и писатель.' });

  const sitemap = await ctx.request.get('/sitemap.xml');
  assert.match(sitemap.text, /\/podborki\/knigi-na-noch/);
  assert.match(sitemap.text, /\/avtory\/anton-chehov/);
  assert.match(sitemap.text, /\/podborki<\/loc>/);
});

test('обратная связь: сообщение сохраняется, автор его видит в админке', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const page = await ctx.request.get('/obratnaya-svyaz');
  assert.equal(page.status, 200);

  const token = /name="_csrf"\s+value="([a-f0-9]{64})"/.exec(page.text)[1];
  const sent = await ctx.request
    .post('/obratnaya-svyaz')
    .set('Cookie', page.headers['set-cookie'])
    .type('form')
    .send({
      _csrf: token,
      name: 'Читатель',
      email: 'reader@example.com',
      kind: 'ошибка',
      text: 'На странице книги не сохраняется прогресс, если нажать дважды.',
      page: '/knigi/duna'
    });

  assert.equal(sent.status, 200);
  assert.match(sent.text, /Записал/);

  const items = await ctx.services.moderationService.feedbackList();
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'ошибка');
  assert.equal(items[0].page, '/knigi/duna');
  assert.match(items[0].text, /не сохраняется прогресс/);
});

test('обратная связь: короткое сообщение и кривой e-mail отклоняются с подсказкой', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const page = await ctx.request.get('/obratnaya-svyaz');
  const token = /name="_csrf"\s+value="([a-f0-9]{64})"/.exec(page.text)[1];

  const response = await ctx.request
    .post('/obratnaya-svyaz')
    .set('Cookie', page.headers['set-cookie'])
    .type('form')
    .send({ _csrf: token, name: 'Я', email: 'не-адрес', kind: 'идея', text: 'плохо' });

  assert.equal(response.status, 422);
  assert.match(response.text, /чуть подробнее/);
  assert.match(response.text, /опечатка/);
  assert.equal((await ctx.services.moderationService.feedbackList()).length, 0, 'мусор в журнал не пишется');
});

test('обратная связь: без e-mail тоже принимается', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const page = await ctx.request.get('/obratnaya-svyaz');
  const token = /name="_csrf"\s+value="([a-f0-9]{64})"/.exec(page.text)[1];

  const response = await ctx.request
    .post('/obratnaya-svyaz')
    .set('Cookie', page.headers['set-cookie'])
    .type('form')
    .send({ _csrf: token, name: 'Аноним', kind: 'неудобно', text: 'Хочу отметить книгу одной кнопкой, без формы.' });

  assert.equal(response.status, 200);
  const items = await ctx.services.moderationService.feedbackList();
  assert.equal(items[0].email, '');
});

test('админка обратной связи закрыта от читателя', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const reader = await ctx.createUser({ name: 'Читатель' });
  await ctx.login(reader);
  assert.equal((await ctx.agent.get('/admin/obratnaya-svyaz')).status, 403);

  const moderator = await ctx.createUser({ name: 'Модератор', role: 'moderator' });
  const request = require('supertest');
  const modAgent = request.agent(ctx.app);
  await ctx.login(moderator, 'reader2026', modAgent);
  assert.equal((await modAgent.get('/admin/obratnaya-svyaz')).status, 200);
});

test('страница-пример «Книжного года» открыта гостю и ведёт к регистрации', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const response = await ctx.request.get('/knizhnyy-god-primer');
  assert.equal(response.status, 200);
  assert.match(response.text, /Ваш год/);
  assert.match(response.text, /Собрать свой год/);
  assert.match(response.text, /\/registratsiya/);
  // Числа примера — образец, а не чьи-то данные
  assert.match(response.text, /образец/);
});

test('sitemap включает страницу-пример года', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const sitemap = await ctx.request.get('/sitemap.xml');
  assert.match(sitemap.text, /knizhnyy-god-primer/);
});

test('стартовые клубы: в файле три клуба с ведущим и расписанием', () => {
  const content = loadContent({ dir: CONTENT_DIR });
  const result = validateContent(content, { genres: GENRES });

  assert.deepEqual(result.errors, [], 'клубы в файле должны быть валидны');
  assert.equal(result.clubs.length, 3, 'на старте должно быть три клуба');

  result.clubs.forEach((club) => {
    assert.ok(club.name.length >= 3);
    assert.ok(club.description.length >= 40, `«${club.name}»: описание слишком короткое`);
    assert.match(club.ownerEmail, /@/, 'у клуба должен быть ведущий');
    assert.ok(club.schedule.length >= 2, `«${club.name}»: в расписании меньше двух встреч`);
    // Даты встреч не в прошлом — иначе клуб выглядит заброшенным
    club.schedule.forEach((slot) => assert.ok(slot.inDays >= 0));
  });
});

test('проверка клубов ловит клуб без ведущего и книгу не из каталога', () => {
  const { validateClubs } = require('../../src/lib/content');
  const { errors } = validateClubs([
    { name: 'Клуб без ведущего', slug: 'klub-bez', description: 'Достаточно длинное описание клуба для проверки.', ownerEmail: '' },
    { name: 'Клуб с чужой книгой', slug: 'klub-kniga', description: 'Достаточно длинное описание клуба для проверки.', ownerEmail: 'a@b.ru', currentBookSlug: 'knigi-net' },
    { name: 'Клуб с датой', slug: 'klub-data', description: 'Достаточно длинное описание клуба для проверки.', ownerEmail: 'a@b.ru', schedule: [{ chapter: 0, inDays: -5 }] }
  ], { bookSlugs: ['kniga-est'] });

  const text = errors.join('\n');
  assert.match(text, /не указан владелец/);
  assert.match(text, /knigi-net.*нет в каталоге/);
  assert.match(text, /глава должна быть целым числом/);
  assert.match(text, /inDays/);
});

test('загрузка клубов: клуб без ведущего пропускается, повтор не дублирует', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const owner = await ctx.createUser({ email: 'vedushchiy@example.com', name: 'Ведущий' });
  const book = await ctx.models.Book.create({
    slug: 'kniga-dlya-kluba', title: 'Книга для клуба', author: 'Автор', description: 'Описание', pages: 200
  });

  const clubs = [
    {
      slug: 'klub-s-vedushchim',
      name: 'Клуб с ведущим',
      description: 'Читаем и обсуждаем раз в неделю, без спешки.',
      ownerEmail: 'vedushchiy@example.com',
      currentBookSlug: 'kniga-dlya-kluba',
      schedule: [{ chapter: 1, inDays: 3, note: 'Первая встреча' }, { chapter: 2, inDays: 10, note: 'Вторая встреча' }]
    },
    {
      slug: 'klub-bez-vedushchego',
      name: 'Клуб без ведущего',
      description: 'Такого человека в базе нет — клуб создавать не из чего.',
      ownerEmail: 'nikogo@example.com',
      schedule: []
    }
  ];

  const first = await ctx.services.contentService.loadClubs(clubs);
  assert.equal(first.created, 1);
  assert.equal(first.skipped, 1);
  assert.deepEqual(first.missingOwners, ['nikogo@example.com']);

  const club = await ctx.models.Club.findOne({ where: { slug: 'klub-s-vedushchim' } });
  assert.equal(club.ownerId, owner.id);
  assert.equal(club.currentBookId, book.id);

  // Ведущий — участник клуба с ролью lead, иначе в клубе нет хозяина
  const member = await ctx.models.ClubMember.findOne({ where: { clubId: club.id, userId: owner.id } });
  assert.equal(member.role, 'lead');

  const schedule = await ctx.models.ClubSchedule.findAll({ where: { clubId: club.id }, order: [['chapter', 'ASC']] });
  assert.equal(schedule.length, 2);
  assert.ok(schedule[0].discussionOn, 'у встречи должна быть дата');

  // Повторный запуск не создаёт второй клуб и второе расписание
  const second = await ctx.services.contentService.loadClubs(clubs);
  assert.equal(second.created, 0);
  assert.equal(await ctx.models.Club.count(), 1);
  assert.equal(await ctx.models.ClubSchedule.count(), 2);
});
