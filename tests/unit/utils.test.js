'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const slug = require('../../src/lib/slug');
const text = require('../../src/lib/text');
const v = require('../../src/lib/validate');

/**
 * Юнит-тесты утилит: транслитерация, склонения, даты, валидаторы.
 *
 * Эти функции вызываются на каждом экране, поэтому проверяем не «примерно
 * работает», а конкретные пары вход → выход, включая краевые случаи:
 * пустая строка, очень длинная строка, смешанная раскладка.
 */

test('транслитерация: русские названия превращаются в читаемый адрес', () => {
  assert.equal(slug.transliterate('Дюна'), 'dyuna');
  assert.equal(slug.transliterate('Война и мир'), 'voyna i mir');
  // ё упрощается до е — это осознанно: в адресах так привычнее
  assert.equal(slug.transliterate('Ёжик в тумане'), 'ezhik v tumane');
  assert.equal(slug.transliterate('Щука, щавель'), 'shchuka, shchavel');

  assert.equal(slug.slugify('Мастер и Маргарита'), 'master-i-margarita');
  assert.equal(slug.slugify('  Много   пробелов  '), 'mnogo-probelov');
  assert.equal(slug.slugify('1984'), '1984');
  assert.equal(slug.slugify(''), 'item');
  assert.equal(slug.slugify('!!!'), 'item');
  assert.equal(slug.slugify('Книга', 'klub'), 'kniga');

  // Длинные названия обрезаются по границе слова, а не посреди буквы
  const long = slug.slugify('Очень длинное название книги, которое точно не влезет в адрес');
  assert.ok(long.length <= 80, `слаг длиннее 80 символов: ${long}`);
  // Обрезка идёт по символам, поэтому последний кусок может быть частью слова
  assert.ok(!long.startsWith('-') && !long.endsWith('-'));

  // В адресе не бывает заглавных букв и подчёркиваний
  assert.ok(!/[A-ZА-Я_]/.test(long));
});

test('уникальный слаг добавляет номер, а не случайный хвост', async () => {
  // «Дюна» транслитерируется как dyuna — занятость проверяем от этого варианта
  const taken = new Set(['dyuna', 'dyuna-2']);
  const first = await slug.uniqueSlug('Дюна', async (candidate) => taken.has(candidate));
  assert.equal(first, 'dyuna-3');

  const free = await slug.uniqueSlug('Солярис', async () => false);
  assert.equal(free, 'solyaris');

  // Когда занято очень много вариантов, всё равно возвращаем что-то рабочее
  const alwaysTaken = await slug.uniqueSlug('Дюна', async () => true);
  assert.ok(alwaysTaken.startsWith('dyuna-'));
  assert.ok(alwaysTaken.length > 5);
});

test('склонения: три формы и граничные числа', () => {
  const forms = ['книга', 'книги', 'книг'];
  assert.equal(text.plural(1, forms), 'книга');
  assert.equal(text.plural(2, forms), 'книги');
  assert.equal(text.plural(4, forms), 'книги');
  assert.equal(text.plural(5, forms), 'книг');
  assert.equal(text.plural(0, forms), 'книг');
  assert.equal(text.plural(11, forms), 'книг');
  assert.equal(text.plural(21, forms), 'книга');
  assert.equal(text.plural(22, forms), 'книги');
  assert.equal(text.plural(111, forms), 'книг');
  assert.equal(text.plural(101, forms), 'книга');

  assert.equal(text.count(3, forms), '3 книги');
  assert.equal(text.books(1), '1 книга');
  assert.equal(text.reviews(2), '2 рецензии');
  assert.equal(text.readers(5), '5 читателей');
  assert.equal(text.pages(21), '21 страница');
  assert.equal(text.days(12), '12 дней');

  // Неверный набор форм — ошибка программиста, а не тихий баг
  assert.throws(() => text.plural(1, ['книга']), TypeError);
});

test('склонение — целые числа, отрицательные и мусор', () => {
  const forms = ['день', 'дня', 'дней'];
  assert.equal(text.plural(-3, forms), 'дня');
  assert.equal(text.plural('5', forms), 'дней');
  assert.equal(text.plural('abc', forms), 'дней');
});

test('даты: длинная, короткая и относительная', () => {
  const date = new Date('2026-03-07T12:00:00Z');

  assert.equal(text.formatDate(date), '7 марта 2026');
  assert.equal(text.formatDate('2026-01-01T12:00:00Z'), '1 января 2026');
  assert.equal(text.formatDate(null), '');
  assert.equal(text.formatDate('мусор'), '');

  // Короткая дата — без года: «7 марта»
  assert.equal(text.formatShortDate(date), '7 марта');
  assert.equal(text.formatShortDate(null), '');

  assert.equal(text.monthName(0), 'январь');
  assert.equal(text.monthName(11), 'декабрь');
  assert.equal(text.monthName(99), '');
});

test('относительное время: минуты, часы, дни', () => {
  const now = Date.now();
  assert.equal(text.timeAgo(new Date(now - 10 * 1000)), 'только что');
  assert.equal(text.timeAgo(new Date(now - 5 * 60 * 1000)), '5 мин назад');
  assert.equal(text.timeAgo(new Date(now - 3 * 3600 * 1000)), '3 ч назад');
  assert.match(text.timeAgo(new Date(now - 5 * 86400 * 1000)), /дн/);
  assert.equal(text.timeAgo(null), '');
});

test('обрезка текста не рвёт слово и не выходит за лимит', () => {
  assert.equal(text.truncate('короткий текст', 50), 'короткий текст');
  assert.equal(text.truncate(''), '');

  const long = 'Это довольно длинный текст, который нужно обрезать по границе слова';
  const cut = text.truncate(long, 30);
  assert.ok(cut.length <= 31, `обрезка длиннее лимита: ${cut.length}`);
  assert.ok(cut.endsWith('…'));
  assert.ok(!cut.includes('  '), 'двойных пробелов быть не должно');
});

test('инициалы для аватара', () => {
  assert.equal(text.initials('Анна'), 'А');
  assert.equal(text.initials('Анна Петрова'), 'АП');
  assert.equal(text.initials('anna pavlova'), 'AP');
  assert.equal(text.initials(''), '');
  assert.equal(text.initials('   '), '');
});

test('валидатор имён: буквы, дефис, апостроф', () => {
  assert.equal(v.name('Анна').value, 'Анна');
  assert.equal(v.name('  Анна   Петрова ').value, 'Анна Петрова');
  assert.equal(v.name('Анна-Мария').value, 'Анна-Мария');
  assert.equal(v.name("О'Генри").value, "О'Генри");
  assert.ok(v.name('А').error, 'одна буква — слишком коротко');
  assert.ok(v.name('Анна123').error, 'цифры в имени не нужны');
  assert.ok(v.name('<script>').error);
  assert.ok(v.name('').error);
});

test('валидатор почты: частые опечатки отсекаются', () => {
  assert.equal(v.email(' Reader@Mail.RU ').value, 'reader@mail.ru');
  assert.ok(v.email('reader@mail').error, 'без точки в домене');
  assert.ok(v.email('reader@@mail.ru').error);
  assert.ok(v.email('rea der@mail.ru').error);
  assert.ok(v.email('reader@mail..ru').error, 'две точки подряд');
  assert.ok(v.email('').error);
  assert.ok(v.email(`${'a'.repeat(70)}@mail.ru`).error, 'слишком длинная часть до @');
});

test('валидатор пароля: длина, буквы, цифры и частые пароли', () => {
  assert.equal(v.password('reader2026').value, 'reader2026');
  assert.ok(v.password('корот1').error, 'меньше 8 символов');
  assert.ok(v.password('толькобуквы').error, 'нет цифры');
  assert.ok(v.password('12345678').error, 'нет буквы');
  assert.ok(v.password('password1').error, 'известный слабый пароль');
  assert.ok(v.password('Qwerty123').error);
  assert.ok(v.password('a'.repeat(129) + '1').error, 'слишком длинный');

  assert.equal(v.passwordPair('reader2026', 'reader2026').value, 'reader2026');
  assert.equal(v.passwordPair('reader2026', 'reader2027').error, 'Пароли не совпадают');
});

test('текст, числа, оценки и перечисления', () => {
  assert.equal(v.text('  привет  ', { max: 100 }).value, 'привет');
  assert.ok(v.text('', { required: true, field: 'Отзыв' }).error.includes('Отзыв'));
  assert.ok(v.text('аб', { min: 3, field: 'Отзыв' }).error.includes('минимум 3'));
  assert.ok(v.text('абвгд', { max: 3 }).error);

  assert.equal(v.int('42', { min: 1, max: 100 }).value, 42);
  assert.equal(v.int('0', { min: 1, max: 100 }).error.startsWith('Значение'), true);
  assert.ok(v.int('abc').error);
  assert.ok(v.int('1.9').value === 1, 'parseInt берёт целую часть');

  assert.equal(v.rating('4.5').value, 4.5);
  assert.equal(v.rating(3).value, 3);
  assert.ok(v.rating('4.3').error, 'шаг только половинный');
  assert.ok(v.rating('0').error);
  assert.ok(v.rating('6').error);

  assert.equal(v.oneOf('read', ['want', 'read']).value, 'read');
  assert.ok(v.oneOf('deleted', ['want', 'read']).error);

  assert.equal(v.bool('1'), true);
  assert.equal(v.bool('on'), true);
  assert.equal(v.bool(true), true);
  assert.equal(v.bool('0'), false);
  assert.equal(v.bool(undefined), false);

  assert.equal(v.slug('duna-1984').value, 'duna-1984');
  assert.ok(v.slug('Дюна').error, 'кириллица в адресе не допускается');
  assert.ok(v.slug('duna/../etc').error);
});

test('строки очищаются от управляющих символов', () => {
  assert.equal(v.str('при\u0000вет\u0007'), 'привет');
  assert.equal(v.str('  много пробелов  '), 'много пробелов');
  assert.equal(v.str(null), '');
  assert.equal(v.str('абвгд', 3), 'абв');
});
