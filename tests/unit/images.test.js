'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { buildCoverSvg, SIZES, GENRE_PALETTE, wrap, fitTitle } = require('../../src/services/cover');
const { buildAvatarSvg, buildAuthorSvg, buildClubSvg, initials } = require('../../src/services/portrait');

/**
 * Обложки и портреты.
 *
 * Проверяем то, что видно глазом, но легко сломать рефакторингом:
 *  - обложка детерминирована (один слаг — одна картинка);
 *  - текст не вылезает за поле (это уже ловили дважды);
 *  - SVG всегда валидный XML и не содержит сырых кавычек в тексте;
 *  - все жанры каталога имеют свою палитру.
 */

const BOOKS = [
  ['1984', 'Джордж Оруэлл', 'Антиутопия'],
  ['Мастер и Маргарита', 'Михаил Булгаков', 'Русская классика'],
  ['Сто лет одиночества', 'Габриэль Гарсиа Маркес', 'Зарубежная классика'],
  ['Преступление и наказание', 'Фёдор Достоевский', 'Русская классика'],
  ['Пикник на обочине', 'Аркадий и Борис Стругацкие', 'Фантастика'],
  ['Очень длинное название книги, которое точно не влезает в одну строку', 'Автор', 'Поэзия']
];

test('обложка детерминирована: один слаг — одна картинка', () => {
  const first = buildCoverSvg({ title: 'Дюна', author: 'Фрэнк Герберт', genre: 'Фантастика', slug: 'duna' });
  const second = buildCoverSvg({ title: 'Дюна', author: 'Фрэнк Герберт', genre: 'Фантастика', slug: 'duna' });
  assert.equal(first, second);

  const other = buildCoverSvg({ title: 'Дюна', author: 'Фрэнк Герберт', genre: 'Фантастика', slug: 'duna-2' });
  assert.notEqual(first, other, 'разные слаги дают разные обложки');
});

test('обложка валидный SVG нужного размера', async () => {
  for (const [title, author, genre] of BOOKS) {
    for (const size of ['card', 'large']) {
      const svg = buildCoverSvg({ title, author, genre, slug: 'test-slug', size });
      assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
      assert.match(svg, new RegExp(`width="${SIZES[size].width}"`));
      assert.match(svg, new RegExp(`height="${SIZES[size].height}"`));

      // sharp парсит разметку: если SVG битый, здесь будет ошибка
      const meta = await sharp(Buffer.from(svg)).metadata();
      assert.equal(meta.width, SIZES[size].width);
      assert.equal(meta.height, SIZES[size].height);
    }
  }
});

test('название не вылезает за поле обложки', () => {
  for (const [title, , genre] of BOOKS) {
    for (const size of ['card', 'large']) {
      const svg = buildCoverSvg({ title, author: 'Автор', genre, slug: 's', size });
      const { width } = SIZES[size];
      // Поле: 9 % отступа слева и справа плюс корешок
      const usable = width - width * 0.09 * 2 - width * 0.05;

      // Достаём все <text> названия: они идут шрифтом 700 в серифном семействе
      const titleTexts = [...svg.matchAll(/<text[^>]*font-size="(\d+)"[^>]*font-weight="700"[^>]*>([^<]*)<\/text>/g)];
      assert.ok(titleTexts.length > 0, `${title}: не нашлось текста названия`);

      for (const [, size_, text] of titleTexts) {
        const measured = text.length * Number(size_) * 0.66;
        assert.ok(
          measured <= usable + 1,
          `${title} (${size}): строка «${text}» шире поля (${Math.round(measured)} > ${Math.round(usable)})`
        );
      }
    }
  }
});

test('текст названия целиком попадает на обложку без сокращений', () => {
  for (const [title, , genre] of BOOKS) {
    const svg = buildCoverSvg({ title, author: 'Автор', genre, slug: 's' });
    // Ни одно слово названия не должно превратиться в «слов…»
    const words = title.split(/\s+/).filter((word) => word.length > 3);
    for (const word of words) {
      assert.ok(svg.includes(word), `${title}: слово «${word}» потерялось`);
    }
    assert.ok(!/[А-Яа-яA-Za-z]…/.test(svg), `${title}: название сокращено многоточием`);
  }
});

test('спецсимволы экранируются, разметка не ломается', async () => {
  const svg = buildCoverSvg({
    title: 'Книга <script>alert(1)</script> & "кавычки"',
    author: 'Джон "О\'Хара" & Ко',
    genre: 'Фантастика',
    slug: 'xss'
  });
  assert.ok(!svg.includes('<script>'), 'в SVG попал тег скрипта');
  assert.ok(svg.includes('&amp;'));
  await assert.doesNotReject(sharp(Buffer.from(svg)).metadata());
});

test('у каждого жанра каталога своя палитра', () => {
  const genres = Object.keys(GENRE_PALETTE);
  assert.ok(genres.length >= 18, `жанров в палитре только ${genres.length}`);
  for (const genre of genres) {
    const palette = GENRE_PALETTE[genre];
    for (const key of ['spine', 'paper', 'ink', 'accent']) {
      assert.match(palette[key], /^#[0-9a-f]{6}$/i, `${genre}.${key}`);
    }
  }
  // Незнакомый жанр не должен ломать рендер
  assert.doesNotThrow(() => buildCoverSvg({ title: 'Книга', author: 'Автор', genre: 'Неизвестный жанр', slug: 'x' }));
});

test('wrap не рвёт слова и не добавляет многоточий', () => {
  const lines = wrap('Преступление и наказание', 12);
  for (const line of lines) {
    assert.ok(!line.includes('…'));
    assert.ok(line.length <= 12 || line.split(' ').length === 1);
  }
  assert.equal(lines.join(' '), 'Преступление и наказание');
});

test('fitTitle уменьшает кегль, пока текст не влезет по высоте', () => {
  const big = fitTitle('Слово '.repeat(8).trim(), 400, 200, { maxSize: 80 });
  const small = fitTitle('Слово', 400, 200, { maxSize: 80 });
  assert.ok(big.size < small.size, 'длинное название должно быть мельче');
  assert.ok(big.lines.length * big.lineHeight <= 200);
});

test('аватар: монограмма и постоянный цвет', async () => {
  assert.equal(initials('Анна Петрова'), 'АП');
  assert.equal(initials('Анна'), 'А');
  assert.equal(initials('анна-мария соколова'), 'АМ');
  assert.equal(initials('  Лев   Толстой '), 'ЛТ');
  assert.equal(initials(''), 'Ч');

  const first = buildAvatarSvg({ name: 'Анна Петрова', pivot: 7 });
  const second = buildAvatarSvg({ name: 'Анна Петрова', pivot: 7 });
  assert.equal(first, second, 'цвет и буквы не должны «прыгать» между запросами');

  // Цвет зависит от id: у соседних id он может совпасть, но на десятке
  // читателей палитра обязана «рассыпаться», иначе список выглядит серым
  const fills = new Set(
    Array.from({ length: 12 }, (_, index) => (
      buildAvatarSvg({ name: 'Анна Петрова', pivot: index + 1 }).match(/circle[^>]*fill="(#[0-9a-f]{6})"/)[1]
    ))
  );
  assert.ok(fills.size >= 4, `на 12 читателей всего ${fills.size} цвет(ов)`);

  const meta = await sharp(Buffer.from(first)).metadata();
  assert.equal(meta.width, 160);
  assert.ok(first.includes('АП'));
});

test('портрет автора: экслибрис, а не лицо', async () => {
  const svg = buildAuthorSvg({ name: 'Михаил Булгаков', years: '1891–1940', size: 480 });
  assert.ok(svg.includes('МБ'));
  assert.ok(svg.includes('МИХАИЛ БУЛГАКОВ'));
  assert.ok(svg.includes('1891–1940'));
  const meta = await sharp(Buffer.from(svg)).metadata();
  assert.equal(meta.width, 480);
});

test('обложка клуба: название и счётчики на месте', async () => {
  const svg = buildClubSvg({ name: 'Классика по средам', members: 14, meetings: 3 });
  assert.ok(svg.includes('Классика по средам'));
  assert.ok(svg.includes('14 участников · 3 встреч'));
  const meta = await sharp(Buffer.from(svg)).metadata();
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 420);
});
