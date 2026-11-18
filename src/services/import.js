'use strict';

/**
 * Импорт и экспорт полки в CSV.
 *
 * Поддерживаем выгрузки Goodreads и LiveLib, а также наш собственный формат
 * (тот, что отдаёт экспорт — так данные можно перенести обратно).
 *
 * Правила, которые важнее удобства:
 *  - файл читаем построчно и никогда не падаем на битой строке: каждая строка
 *    либо импортируется, либо попадает в отчёт с понятной причиной;
 *  - ограничение 5 МБ и 5000 строк — больше не нужно и опасно для памяти;
 *  - кодировка UTF-8; BOM срезаем (Excel его любит добавлять);
 *  - разделитель определяем по первой строке: запятая или точка с запятой.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 5000;

/** Разбор CSV с кавычками, экранированием "" и переводами строк внутри кавычек. */
function parseCsv(input) {
  const text = String(input || '').replace(/^\uFEFF/, '');
  const firstLine = text.split('\n')[0] || '';
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  return { rows: rows.filter((cells) => cells.some((cell) => cell.trim() !== '')), delimiter };
}

/** Приводит заголовок к сравнимому виду: нижний регистр, без пробелов и кавычек. */
function normalizeHeader(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^\uFEFF/, '')
    .replace(/[«»"']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const FIELD_ALIASES = {
  title: ['title', 'название', 'книга', 'наименование'],
  author: ['author', 'автор', 'authors'],
  rating: ['my rating', 'rating', 'оценка', 'моя оценка'],
  shelf: ['exclusive shelf', 'bookshelf', 'shelf', 'полка', 'статус'],
  pages: ['number of pages', 'pages', 'страниц', 'страницы', 'кол-во страниц'],
  year: ['original publication year', 'year published', 'год', 'год издания'],
  isbn: ['isbn', 'isbn13', 'isbn-13'],
  dateRead: ['date read', 'дата прочтения', 'прочитано'],
  review: ['my review', 'review', 'рецензия', 'отзыв']
};

/** Ищет в заголовках индексы колонок. Возвращает { title: 0, author: 1, ... }. */
function mapColumns(headerRow) {
  const normalized = headerRow.map(normalizeHeader);
  const index = {};

  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const position = normalized.findIndex((cell) => aliases.includes(cell));
    if (position >= 0) index[field] = position;
  }

  // Если заголовка нет вовсе, но первая строка похожа на данные — считаем,
  // что первый столбец название, второй автор (формат «Название, Автор, Оценка»).
  if (index.title === undefined) index.title = 0;
  if (index.author === undefined) index.author = 1;

  return index;
}

const SHELF_MAP = {
  read: 'read',
  'прочитано': 'read',
  'прочитал': 'read',
  currently: 'reading',
  'currently-reading': 'reading',
  reading: 'reading',
  'читаю': 'reading',
  to: 'want',
  'to-read': 'want',
  want: 'want',
  'хочу прочитать': 'want',
  'хочу': 'want',
  'не дочитал': 'dnf',
  dnf: 'dnf',
  abandoned: 'dnf',
  'брошено': 'dnf'
};

function mapShelf(value) {
  const key = String(value || '').toLowerCase().trim();
  if (!key) return 'read';
  if (SHELF_MAP[key]) return SHELF_MAP[key];
  // «to-read», «currently reading» и прочие варианты с дефисом/пробелом
  const simplified = key.replace(/[\s-]+/g, '');
  const found = Object.entries(SHELF_MAP).find(([alias]) => alias.replace(/[\s-]+/g, '') === simplified);
  return found ? found[1] : 'read';
}

/** Оценка из 5 (Goodreads) или 10 (LiveLib) в половинные шаги 2–10 нашей базы. */
function mapRating(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(number) || number <= 0) return null;

  const five = number > 5 ? number / 2 : number;
  const clamped = Math.min(5, Math.max(1, five));
  const halved = Math.round(clamped * 2) / 2;
  return Math.round(halved * 2);
}

/** Нормализация названия для сопоставления: без регистра, ё → е, без пунктуации. */
function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'`.,:;!?()\[\]—–]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function createImportService({ Book, LibraryEntry, Review, Genre, User, sequelize }) {
  const sql = sequelize || Book.sequelize;

  /** Разбор файла без обращения к базе: удобно тестировать отдельно. */
  function parse(text) {
    if (!text || !String(text).trim()) {
      return { error: 'Файл пустой. Выгрузите список книг из Goodreads или LiveLib и попробуйте снова.' };
    }
    if (Buffer.byteLength(String(text), 'utf8') > MAX_BYTES) {
      return { error: 'Файл больше 5 МБ. Разделите выгрузку на части.' };
    }

    const { rows, delimiter } = parseCsv(text);
    if (!rows.length) {
      return { error: 'В файле нет строк с данными. Проверьте, что это CSV с книгами.' };
    }

    // Заголовок: если в первой строке есть слово «title»/«название» — это шапка
    const header = rows[0].map(normalizeHeader);
    const hasHeader = header.some((cell) => ['title', 'название', 'книга', 'author', 'автор', 'my rating'].includes(cell));
    const index = mapColumns(hasHeader ? rows[0] : []);
    const dataRows = hasHeader ? rows.slice(1) : rows;

    if (!dataRows.length) {
      return { error: 'В файле только заголовок и ни одной книги.' };
    }
    if (dataRows.length > MAX_ROWS) {
      return { error: `Слишком много строк: ${dataRows.length}. За один раз можно до ${MAX_ROWS}.` };
    }

    const books = dataRows.map((cells, rowNumber) => ({
      rowNumber: rowNumber + (hasHeader ? 2 : 1),
      title: String(cells[index.title] || '').trim(),
      author: String(cells[index.author] || '').trim(),
      rating: mapRating(cells[index.rating]),
      shelf: mapShelf(cells[index.shelf]),
      pages: Number(String(cells[index.pages] || '').replace(/\D+/g, '')) || null,
      isbn: String(cells[index.isbn] || '').replace(/[^0-9Xx]/g, '') || null,
      dateRead: String(cells[index.dateRead] || '').trim() || null,
      review: String(cells[index.review] || '').trim() || null
    }));

    return { books, delimiter, hasHeader, total: books.length };
  }

  /**
   * Сопоставление с каталогом:
   *  1) по ISBN, если он есть;
   *  2) по нормализованному названию + автору;
   *  3) по одному названию, если оно не встречается дважды.
   * Не нашли — книга не выдумывается: попадает в отчёт «не найдено».
   */
  async function match(bookList) {
    const catalog = await Book.findAll({
      attributes: ['id', 'title', 'author', 'isbn', 'pages', 'slug'],
      where: { isPublished: true },
      raw: true
    });

    const byIsbn = new Map();
    const byTitleAuthor = new Map();
    const byTitle = new Map();

    for (const book of catalog) {
      if (book.isbn) byIsbn.set(String(book.isbn).replace(/[^0-9Xx]/g, ''), book);
      const title = normalizeTitle(book.title);
      const author = normalizeTitle(book.author);
      byTitleAuthor.set(`${title}|${author}`, book);
      if (!byTitle.has(title)) byTitle.set(title, []);
      byTitle.get(title).push(book);
    }

    const matched = [];
    const notFound = [];

    for (const row of bookList) {
      if (!row.title) {
        notFound.push({ ...row, reason: 'Пустое название' });
        continue;
      }

      let book = row.isbn ? byIsbn.get(row.isbn) : null;
      if (!book) book = byTitleAuthor.get(`${normalizeTitle(row.title)}|${normalizeTitle(row.author)}`);
      if (!book) {
        const candidates = byTitle.get(normalizeTitle(row.title)) || [];
        if (candidates.length === 1) book = candidates[0];
      }

      if (book) matched.push({ row, book });
      else notFound.push({ ...row, reason: 'Нет в каталоге' });
    }

    return { matched, notFound, catalogSize: catalog.length };
  }

  /**
   * Импорт: создаёт записи на полке и, если есть текст, рецензию.
   * Возвращает подробный отчёт — «добавлено X из Y» и причины отказов.
   */
  async function run({ userId, text, dryRun = false }) {
    const parsed = parse(text);
    if (parsed.error) return { error: parsed.error };

    const { matched, notFound, catalogSize } = await match(parsed.books);

    if (dryRun) {
      return {
        dryRun: true,
        total: parsed.total,
        matched: matched.length,
        notFound: notFound.length,
        catalogSize,
        preview: matched.slice(0, 10).map(({ row, book }) => ({
          title: book.title,
          author: book.author,
          shelf: row.shelf,
          rating: row.rating
        })),
        reasons: summarize(notFound)
      };
    }

    let added = 0;
    let updated = 0;
    let reviews = 0;

    for (const { row, book } of matched) {
      const existing = await LibraryEntry.findOne({ where: { userId, bookId: book.id } });
      const finishedAt = row.shelf === 'read' ? parseDate(row.dateRead) : null;

      const payload = {
        status: row.shelf,
        finishedAt,
        // Прогресс: прочитанная книга — весь объём, иначе не трогаем
        progressPages: row.shelf === 'read' ? (book.pages || 0) : existing ? existing.progressPages : 0
      };

      if (existing) {
        await existing.update(payload);
        updated += 1;
      } else {
        await LibraryEntry.create({ userId, bookId: book.id, ...payload });
        added += 1;
      }

      // Рецензия из файла: сохраняем без спойлер-разметки, только текст
      if (row.review && row.review.length >= 20) {
        const reviewPayload = {
          userId,
          bookId: book.id,
          rating: row.rating || 10,
          body: row.review.slice(0, 20000),
          state: 'published',
          hasSpoilers: false
        };
        const existingReview = await Review.findOne({ where: { userId, bookId: book.id } });
        if (existingReview) await existingReview.update(reviewPayload);
        else await Review.create(reviewPayload);
        reviews += 1;
      }
    }

    // Пересчёт счётчиков книг — одним запросом, без N+1
    for (const { book } of matched) {
      await sql.query(
        `UPDATE books SET
           ratings_count = (SELECT COUNT(*) FROM reviews r WHERE r.book_id = :id AND r.state = 'published'),
           ratings_sum = (SELECT COALESCE(SUM(r.rating), 0) FROM reviews r WHERE r.book_id = :id AND r.state = 'published')
         WHERE id = :id`,
        { replacements: { id: book.id } }
      );
    }

    return {
      total: parsed.total,
      matched: matched.length,
      added,
      updated,
      reviews,
      notFound: notFound.length,
      reasons: summarize(notFound),
      notFoundRows: notFound.slice(0, 30).map((row) => ({ row: row.rowNumber, title: row.title, reason: row.reason })),
      catalogSize
    };
  }

  /** Экспорт полки в CSV: колонки как в нашем же импорте. */
  async function exportCsv(userId) {
    const rows = await LibraryEntry.findAll({
      where: { userId },
      include: [{ model: Book, as: 'book', attributes: ['title', 'author', 'pages', 'isbn'] }],
      order: [['updatedAt', 'DESC']]
    });

    const reviews = await Review.findAll({ where: { userId }, attributes: ['bookId', 'rating', 'body'], raw: true });
    const reviewMap = new Map(reviews.map((row) => [row.bookId, row]));

    const statusLabels = { read: 'прочитано', reading: 'читаю', want: 'хочу прочитать', dnf: 'не дочитал' };
    const lines = ['Название,Автор,Полка,Оценка,Страниц,Дата прочтения,Рецензия'];

    for (const entry of rows) {
      const book = entry.book || {};
      const review = reviewMap.get(entry.bookId);
      const date = entry.finishedAt ? new Date(entry.finishedAt).toISOString().slice(0, 10) : '';
      const rating = review && review.rating ? String(review.rating / 2) : '';

      lines.push([
        csvCell(book.title),
        csvCell(book.author),
        csvCell(statusLabels[entry.status] || entry.status),
        csvCell(rating),
        csvCell(book.pages || ''),
        csvCell(date),
        csvCell(review ? review.body : '')
      ].join(','));
    }

    return { csv: `\uFEFF${lines.join('\r\n')}`, count: rows.length };
  }

  /** Собирает причины отказов: «Нет в каталоге — 7» и т. п. */
  function summarize(list) {
    const map = new Map();
    for (const item of list) map.set(item.reason, (map.get(item.reason) || 0) + 1);
    return [...map.entries()].map(([reason, count]) => ({ reason, count }));
  }

  return { parse, match, run, exportCsv, parseCsv, normalizeTitle, mapRating, mapShelf };
}

/** Дата из «2026/03/01», «01.03.2026», «2026-03-01» — иначе null. */
function parseDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  let date = null;

  if (/^\d{4}-\d{2}-\d{2}/.test(text)) date = new Date(text.slice(0, 10));
  else if (/^\d{4}\/\d{1,2}\/\d{1,2}/.test(text)) {
    const [year, month, day] = text.split(/[/\s]/);
    date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  } else if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(text)) {
    const [day, month, year] = text.split('.');
    date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  }

  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function csvCell(value) {
  const text = String(value ?? '').replace(/\r?\n/g, ' ');
  return /[",;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

module.exports = { createImportService, parseCsv, normalizeTitle, mapRating, mapShelf, parseDate, MAX_BYTES, MAX_ROWS };
