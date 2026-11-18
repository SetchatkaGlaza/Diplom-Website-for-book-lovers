'use strict';

const { Op, literal } = require('sequelize');

/**
 * Полка читателя: статусы, прогресс, перечитывания и цель на год.
 *
 * Правила:
 *  - одна книга — одна запись на полке (уникальный индекс в базе);
 *  - прогресс в страницах не может быть меньше 0 и больше числа страниц книги,
 *    проценты считаются из этих двух чисел и никогда не выходят за 0–100;
 *  - «прочитал» ставит дату окончания, «читаю» — дату начала;
 *  - перечитывание не создаёт вторую запись, а увеличивает счётчик прочтений;
 *  - цель на год одна на человека: она складывается из книг, законченных в этом году.
 */

const STATUSES = [
  { key: 'want', label: 'Хочу прочитать', short: 'Хочу' },
  { key: 'reading', label: 'Читаю', short: 'Читаю' },
  { key: 'read', label: 'Прочитал', short: 'Прочитал' },
  { key: 'dnf', label: 'Бросил', short: 'Бросил' }
];

const STATUS_KEYS = STATUSES.map((status) => status.key);

function statusLabel(key) {
  const found = STATUSES.find((status) => status.key === key);
  return found ? found.label : key;
}

/** Проценты прочитанного: 0 при отсутствии страниц, всегда 0–100. */
function progressPercent(pages, totalPages) {
  const total = Number(totalPages) || 0;
  const read = Number(pages) || 0;
  if (total <= 0) return 0;
  const percent = Math.round((read / total) * 100);
  return Math.max(0, Math.min(100, percent));
}

/** Страницы не выходят за границы книги: 0 … всего страниц. */
function clampPages(pages, totalPages) {
  const value = Math.trunc(Number(pages) || 0);
  const total = Number(totalPages) || 0;
  if (value < 0) return 0;
  if (total > 0 && value > total) return total;
  return value;
}

function createShelfService({ LibraryEntry, Book, ReadingGoal, sequelize }) {
  const sql = sequelize || Book.sequelize;

  /** Записи полки с книгами: одна выборка на список, без запроса на строку. */
  async function list(userId, { status = null, limit = 200 } = {}) {
    const where = { userId };
    if (status && STATUS_KEYS.includes(status)) where.status = status;

    const entries = await LibraryEntry.findAll({
      where,
      include: [{ model: Book, as: 'book', attributes: ['id', 'slug', 'title', 'author', 'pages', 'cover'] }],
      order: [
        [literal("CASE status WHEN 'reading' THEN 0 WHEN 'want' THEN 1 WHEN 'read' THEN 2 ELSE 3 END"), 'ASC'],
        ['updatedAt', 'DESC']
      ],
      limit: Math.min(Math.max(Number(limit) || 200, 1), 500)
    });

    return entries.map((entry) => toItem(entry));
  }

  function toItem(entry, bookHint = null) {
    const plain = entry.get ? entry.get({ plain: true }) : entry;
    // После findOrCreate связь с книгой не подгружается — подставляем переданную
    const book = plain.book || bookHint || {};
    const totalPages = Number(book.pages) || 0;
    const pages = clampPages(plain.progressPages, totalPages);
    return {
      id: plain.id,
      status: plain.status,
      statusLabel: statusLabel(plain.status),
      progressPages: pages,
      totalPages,
      percent: progressPercent(pages, totalPages),
      startedAt: plain.startedAt || null,
      finishedAt: plain.finishedAt || null,
      rereadCount: Number(plain.rereadCount) || 0,
      isFavorite: Boolean(plain.isFavorite),
      updatedAt: plain.updatedAt,
      book: {
        id: book.id,
        slug: book.slug,
        title: book.title,
        author: book.author,
        pages: totalPages
      }
    };
  }

  /**
   * Сколько книг в каждом статусе — для полосы цифр на полке.
   * Считаем одним запросом с группировкой.
   */
  async function counts(userId) {
    const rows = await LibraryEntry.findAll({
      attributes: ['status', [literal('COUNT(*)'), 'total']],
      where: { userId },
      group: ['status'],
      raw: true
    });

    const result = { want: 0, reading: 0, read: 0, dnf: 0, all: 0 };
    for (const row of rows) {
      const key = row.status;
      const total = Number(row.total) || 0;
      if (Object.prototype.hasOwnProperty.call(result, key)) result[key] = total;
      result.all += total;
    }
    return result;
  }

  /** Книга уже на полке? Нужно, чтобы показать правильную кнопку. */
  async function findEntry(userId, bookId) {
    const entry = await LibraryEntry.findOne({ where: { userId, bookId } });
    return entry ? toItem(entry) : null;
  }

  /**
   * Поставить статус. Возвращает { entry } или { error }.
   * Одна функция и для «положить на полку», и для смены статуса.
   */
  async function setStatus({ userId, bookId, status, pages = null, book = null }) {
    if (!STATUS_KEYS.includes(status)) return { error: 'Такого статуса нет' };

    const target = book || await Book.findByPk(bookId);
    if (!target) return { error: 'Книга не найдена' };

    const totalPages = Number(target.pages) || 0;
    const [entry, created] = await LibraryEntry.findOrCreate({
      where: { userId, bookId: target.id },
      defaults: { userId, bookId: target.id, status, progressPages: 0 }
    });

    const patch = { status };

    if (status === 'reading') {
      if (!entry.startedAt) patch.startedAt = new Date();
      patch.finishedAt = null;
    }
    if (status === 'read') {
      patch.finishedAt = entry.finishedAt || new Date();
      patch.startedAt = entry.startedAt || new Date();
      // Дочитал — значит, страниц ровно столько, сколько в книге
      if (totalPages > 0) patch.progressPages = totalPages;
    }
    if (status === 'want') {
      patch.progressPages = 0;
      patch.startedAt = null;
      patch.finishedAt = null;
    }
    if (status === 'dnf') {
      patch.finishedAt = null;
    }
    if (pages !== null) patch.progressPages = clampPages(pages, totalPages);

    await entry.update(patch);
    return { entry: toItem(entry, target), created };
  }

  /**
   * Отметить прогресс в страницах. Книгу на полке создаёт сам, если её там нет:
   * человек листает страницы, а не думает про статусы.
   */
  async function setProgress({ userId, bookId, pages, book = null }) {
    const target = book || await Book.findByPk(bookId);
    if (!target) return { error: 'Книга не найдена' };

    const totalPages = Number(target.pages) || 0;
    const clamped = clampPages(pages, totalPages);

    const [entry, created] = await LibraryEntry.findOrCreate({
      where: { userId, bookId: target.id },
      defaults: { userId, bookId: target.id, status: 'reading', startedAt: new Date(), progressPages: clamped }
    });

    const patch = { progressPages: clamped };
    if (created) {
      patch.status = 'reading';
      patch.startedAt = new Date();
    } else if (entry.status === 'want') {
      // Взялся читать — значит, «читаю»
      patch.status = 'reading';
      patch.startedAt = entry.startedAt || new Date();
    }

    // Дошёл до последней страницы — книга прочитана сама
    let finished = false;
    if (totalPages > 0 && clamped >= totalPages) {
      patch.status = 'read';
      patch.finishedAt = entry.finishedAt || new Date();
      finished = true;
    } else if (entry.status === 'read' && totalPages > 0 && clamped < totalPages) {
      // Вернул прогресс назад — книга снова «читаю»
      patch.status = 'reading';
      patch.finishedAt = null;
    }

    await entry.update(patch);
    return { entry: toItem(entry, target), created, finished };
  }

  /** Перечитывание: +1 к счётчику прочтений, книга остаётся «читаю». */
  async function reread({ userId, bookId }) {
    const entry = await LibraryEntry.findOne({ where: { userId, bookId } });
    if (!entry) return { error: 'Этой книги нет на полке' };

    await entry.update({
      rereadCount: (Number(entry.rereadCount) || 0) + 1,
      status: 'reading',
      progressPages: 0,
      startedAt: new Date(),
      finishedAt: null
    });

    return { entry: toItem(entry) };
  }

  async function toggleFavorite({ userId, bookId }) {
    const entry = await LibraryEntry.findOne({ where: { userId, bookId } });
    if (!entry) return { error: 'Этой книги нет на полке' };
    await entry.update({ isFavorite: !entry.isFavorite });
    return { entry: toItem(entry) };
  }

  async function remove({ userId, bookId }) {
    const removed = await LibraryEntry.destroy({ where: { userId, bookId } });
    return { removed: removed > 0 };
  }

  /** Пересчёт счётчика «сколько человек держат книгу» на самой книге. */
  async function recountShelves(bookId) {
    // Считаем в базе и записываем обновлённое число. Через UPDATE ... SET count =
    // (подзапрос с "Book"."id") не работает: в UPDATE таблица называется иначе.
    try {
      const [{ total }] = await LibraryEntry.findAll({
        attributes: [[sql.literal('COUNT(*)'), 'total']],
        where: { bookId },
        raw: true
      });
      await Book.update({ shelvesCount: Number(total) || 0 }, { where: { id: bookId } });
    } catch (error) {
      // Счётчик — украшение: страница важнее
    }
  }

  /** Цель на год: сколько задано и сколько уже прочитано в этом году. */
  async function goalProgress(userId, year = new Date().getFullYear()) {
    const goal = await ReadingGoal.findOne({ where: { userId, year } });

    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year + 1, 0, 1));
    const finished = await LibraryEntry.count({
      where: { userId, status: 'read', finishedAt: { [Op.gte]: start, [Op.lt]: end } }
    });

    const target = goal ? Number(goal.targetBooks) || 0 : 0;
    return {
      year,
      target,
      finished,
      percent: target > 0 ? Math.min(100, Math.round((finished / target) * 100)) : 0,
      hasGoal: Boolean(goal)
    };
  }

  async function setGoal(userId, year, targetBooks) {
    const yearValue = Number(year) || new Date().getFullYear();
    const target = Math.trunc(Number(targetBooks));
    if (!Number.isFinite(target) || target < 1 || target > 1000) {
      return { error: 'Цель: целое число от 1 до 1000 книг' };
    }

    const [goal, created] = await ReadingGoal.findOrCreate({
      where: { userId, year: yearValue },
      defaults: { userId, year: yearValue, targetBooks: target }
    });
    if (!created) await goal.update({ targetBooks: target });

    return goalProgress(userId, yearValue);
  }

  /** Серия дней подряд: сколько дней до сегодня человек отмечал чтение. */
  async function streak(userId) {
    const rows = await LibraryEntry.findAll({
      attributes: ['updatedAt'],
      where: { userId, status: { [Op.in]: ['reading', 'read'] } },
      order: [['updatedAt', 'DESC']],
      limit: 400
    });

    const days = new Set(rows.map((row) => new Date(row.updatedAt).toISOString().slice(0, 10)));
    let current = 0;
    const cursor = new Date();
    // Считаем от сегодня назад: как только дня нет — серия закончилась
    while (current < 400) {
      const key = cursor.toISOString().slice(0, 10);
      if (!days.has(key)) break;
      current += 1;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    return current;
  }

  return {
    list,
    counts,
    findEntry,
    setStatus,
    setProgress,
    reread,
    toggleFavorite,
    remove,
    recountShelves,
    goalProgress,
    setGoal,
    streak,
    STATUSES
  };
}

module.exports = {
  createShelfService,
  STATUSES,
  STATUS_KEYS,
  statusLabel,
  progressPercent,
  clampPages
};
