'use strict';

/**
 * Проверка контента до того, как он попадёт в базу.
 *
 * Смысл: 300 книг руками — это 300 шансов на опечатку (пустое описание,
 * жанр, которого нет, две книги с одним слагом, цитата на 800 знаков).
 * На сайте такая опечатка выглядит как «сайт сломан», а не как «в данных
 * ошибка». Поэтому контент проверяется отдельной функцией, которую вызывают
 * и загрузчик, и тесты.
 */

const { slugify } = require('./slug');

const LIMITS = {
  title: 2,
  author: 2,
  descriptionMin: 80,
  descriptionMax: 1200,
  books: 400,
  collections: 40,
  authors: 60,
  // Цитата длиннее 300 знаков — это уже не цитата, а пересказ чужого текста
  quoteMax: 300
};

function isFilledString(value, min = 1) {
  return typeof value === 'string' && value.trim().length >= min;
}

/**
 * Проверяет книги. Возвращает { errors, warnings, normalized }.
 * normalized — то, что можно писать в базу: слаг, обрезанные пробелы,
 * год числом.
 */
function validateBooks(books, { genres = [] } = {}) {
  const errors = [];
  const warnings = [];
  const normalized = [];
  const seenSlugs = new Map();
  const knownGenres = new Set(genres);

  if (!Array.isArray(books)) return { errors: ['books.json: ожидался массив'], warnings, normalized };

  if (books.length > LIMITS.books) {
    warnings.push(`книг больше ${LIMITS.books}: загрузка займёт заметное время`);
  }

  books.forEach((raw, index) => {
    const where = `книга №${index + 1}${isFilledString(raw && raw.title) ? ` («${raw.title}»)` : ''}`;

    if (!raw || typeof raw !== 'object') {
      errors.push(`${where}: ожидался объект`);
      return;
    }

    const title = String(raw.title || '').trim();
    const author = String(raw.author || '').trim();
    const description = String(raw.description || '').trim();
    const genre = String(raw.genre || '').trim();
    const year = raw.year === null || raw.year === undefined ? null : Number(raw.year);
    const pages = raw.pages === null || raw.pages === undefined ? null : Number(raw.pages);

    if (title.length < LIMITS.title) errors.push(`${where}: название короче ${LIMITS.title} символов`);
    if (author.length < LIMITS.author) errors.push(`${where}: не указан автор`);

    if (!description) {
      errors.push(`${where}: пустое описание — карточка не индексируется`);
    } else if (description.length < LIMITS.descriptionMin) {
      warnings.push(`${where}: описание короче ${LIMITS.descriptionMin} символов`);
    } else if (description.length > LIMITS.descriptionMax) {
      errors.push(`${where}: описание длиннее ${LIMITS.descriptionMax} символов — это уже пересказ`);
    }

    if (genre && knownGenres.size && !knownGenres.has(genre)) {
      errors.push(`${where}: неизвестный жанр «${genre}»`);
    }

    if (year !== null && (!Number.isInteger(year) || year < 1000 || year > new Date().getFullYear() + 2)) {
      errors.push(`${where}: год издания выглядит странно (${raw.year})`);
    }

    if (pages !== null && (!Number.isInteger(pages) || pages < 10 || pages > 20000)) {
      errors.push(`${where}: число страниц выглядит странно (${raw.pages})`);
    }

    const slug = slugify(`${author} ${title}`, '');
    if (!slug) {
      errors.push(`${where}: из названия и автора не получается адрес`);
      return;
    }

    if (seenSlugs.has(slug)) {
      errors.push(`${where}: адрес «${slug}» уже занят книгой №${seenSlugs.get(slug) + 1}`);
      return;
    }
    seenSlugs.set(slug, index);

    normalized.push({
      slug,
      title,
      author,
      description,
      genre: genre || null,
      year: Number.isInteger(year) ? year : null,
      pages: Number.isInteger(pages) ? pages : null
    });
  });

  return { errors, warnings, normalized };
}

/** Подборки: список книг со слагами, которые должны существовать. */
function validateCollections(collections, { bookSlugs = [] } = {}) {
  const errors = [];
  const warnings = [];
  const normalized = [];
  const seen = new Set();
  const known = new Set(bookSlugs);

  if (!Array.isArray(collections)) return { errors: ['collections.json: ожидался массив'], warnings, normalized };

  collections.forEach((raw, index) => {
    const where = `подборка №${index + 1}${raw && raw.title ? ` («${raw.title}»)` : ''}`;
    if (!raw || typeof raw !== 'object') {
      errors.push(`${where}: ожидался объект`);
      return;
    }

    const title = String(raw.title || '').trim();
    const slug = slugify(raw.slug || title, '');
    const description = String(raw.description || '').trim();
    const books = Array.isArray(raw.books) ? raw.books.map((item) => String(item).trim()).filter(Boolean) : [];

    if (title.length < 3) errors.push(`${where}: слишком короткое название`);
    if (!description) errors.push(`${where}: нет описания — подборка не откроется в поиске`);
    if (!slug) errors.push(`${where}: не получается адрес`);
    if (seen.has(slug)) errors.push(`${where}: адрес «${slug}» уже используется`);

    if (books.length < 3) {
      errors.push(`${where}: меньше трёх книг — это не подборка`);
    }
    books.forEach((bookSlug) => {
      if (known.size && !known.has(bookSlug)) {
        errors.push(`${where}: книга «${bookSlug}» не найдена в каталоге`);
      }
    });

    if (books.length > 20) warnings.push(`${where}: больше 20 книг — подборку никто не пролистает`);

    seen.add(slug);
    normalized.push({ slug, title, description, books });
  });

  return { errors, warnings, normalized };
}

/** Авторы: имя и хотя бы одна книга, иначе страница пустая. */
function validateAuthors(authors, { bookAuthors = [] } = {}) {
  const errors = [];
  const warnings = [];
  const normalized = [];
  const seen = new Set();
  const known = new Set(bookAuthors.map((name) => name.toLowerCase()));

  if (!Array.isArray(authors)) return { errors: ['authors.json: ожидался массив'], warnings, normalized };

  authors.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') {
      errors.push(`автор №${index + 1}: ожидался объект`);
      return;
    }

    const name = String(raw.name || '').trim();
    const slug = slugify(raw.slug || name, '');
    const bio = String(raw.bio || '').trim();
    const where = `автор «${name || `№${index + 1}`}»`;

    if (name.length < 2) errors.push(`${where}: нет имени`);
    if (!bio) {
      warnings.push(`${where}: без биографии страница будет пустой`);
    } else if (bio.length > 1500) {
      errors.push(`${where}: биография длиннее 1500 символов`);
    }
    if (seen.has(slug)) errors.push(`${where}: адрес «${slug}» уже используется`);
    if (known.size && !known.has(name.toLowerCase())) {
      warnings.push(`${where}: в каталоге нет книг этого автора`);
    }

    seen.add(slug);
    normalized.push({ slug, name, bio, years: String(raw.years || '').trim() });
  });

  return { errors, warnings, normalized };
}

/**
 * Проверяет стартовые клубы.
 *
 * Клуб — не справочник, а место, куда человек приходит и видит расписание.
 * Поэтому проверяем то, что делает клуб бесполезным: нет названия, нет
 * владельца, расписание без дат или книга, которой нет в каталоге.
 * Владелец задаётся адресом: id в файле нет смысла — на проде база другая.
 */
function validateClubs(clubs, { bookSlugs = [] } = {}) {
  const errors = [];
  const warnings = [];
  const normalized = [];
  const seen = new Set();
  const knownBooks = new Set(bookSlugs);

  if (!Array.isArray(clubs)) return { errors: ['clubs.json: ожидался массив клубов'], warnings, normalized };

  clubs.forEach((raw, index) => {
    const where = `клуб №${index + 1}${isFilledString(raw && raw.name) ? ` («${raw.name}»)` : ''}`;

    if (!raw || typeof raw !== 'object') {
      errors.push(`${where}: ожидался объект`);
      return;
    }

    const name = String(raw.name || '').trim();
    const slug = String(raw.slug || '').trim() || slugify(name, `klub-${index + 1}`);
    const description = String(raw.description || '').trim();
    const ownerEmail = String(raw.ownerEmail || '').trim().toLowerCase();
    const currentBookSlug = String(raw.currentBookSlug || '').trim();

    if (name.length < 3) errors.push(`${where}: название короче 3 символов`);
    if (name.length > 120) errors.push(`${where}: название длиннее 120 символов`);
    if (!/^[a-z0-9-]+$/.test(slug)) errors.push(`${where}: адрес «${slug}» — только латиница, цифры и дефис`);
    if (seen.has(slug)) errors.push(`${where}: адрес «${slug}» уже используется`);
    if (description.length < 40) errors.push(`${where}: описание короче 40 символов — непонятно, зачем идти`);
    if (description.length > 1000) warnings.push(`${where}: описание длиннее 1000 символов`);
    if (!ownerEmail) errors.push(`${where}: не указан владелец (ownerEmail) — клуб некому вести`);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(ownerEmail)) errors.push(`${where}: адрес владельца выглядит странно`);

    if (currentBookSlug && knownBooks.size && !knownBooks.has(currentBookSlug)) {
      errors.push(`${where}: книги «${currentBookSlug}» нет в каталоге`);
    }

    const schedule = (Array.isArray(raw.schedule) ? raw.schedule : []).map((item, scheduleIndex) => {
      const chapter = Number(item && item.chapter);
      const inDays = Number(item && item.inDays);
      if (!Number.isInteger(chapter) || chapter < 1) {
        errors.push(`${where}, расписание №${scheduleIndex + 1}: глава должна быть целым числом от 1`);
      }
      if (!Number.isInteger(inDays) || inDays < 0 || inDays > 365) {
        errors.push(`${where}, расписание №${scheduleIndex + 1}: inDays — число дней от 0 до 365`);
      }
      return {
        chapter: Number.isInteger(chapter) ? chapter : scheduleIndex + 1,
        inDays: Number.isInteger(inDays) ? inDays : 7,
        note: String((item && item.note) || '').slice(0, 300)
      };
    });

    if (schedule.length < 2) warnings.push(`${where}: в расписании меньше двух встреч — клуб будет выглядеть мёртвым`);

    seen.add(slug);
    normalized.push({
      slug,
      name,
      description,
      ownerEmail,
      isPrivate: Boolean(raw.isPrivate),
      currentBookSlug,
      schedule
    });
  });

  return { errors, warnings, normalized };
}

/** Проверка всего контента разом: то, что вызывает загрузчик и тест. */
function validateContent(content, { genres = [] } = {}) {
  const books = validateBooks(content.books || [], { genres });
  const collections = validateCollections(content.collections || [], {
    bookSlugs: books.normalized.map((book) => book.slug)
  });
  const authors = validateAuthors(content.authors || [], {
    bookAuthors: books.normalized.map((book) => book.author)
  });
  const clubs = validateClubs(content.clubs || [], {
    bookSlugs: books.normalized.map((book) => book.slug)
  });

  return {
    errors: [...books.errors, ...collections.errors, ...authors.errors, ...clubs.errors],
    warnings: [...books.warnings, ...collections.warnings, ...authors.warnings, ...clubs.warnings],
    books: books.normalized,
    collections: collections.normalized,
    authors: authors.normalized,
    clubs: clubs.normalized
  };
}

module.exports = {
  LIMITS,
  validateBooks,
  validateCollections,
  validateAuthors,
  validateClubs,
  validateContent
};
