'use strict';

const { Op } = require('sequelize');

/**
 * Статистика читателя и «Книжный год».
 *
 * Все числа считаются от записей на полке, а не «на глаз»:
 *  - книги — записи со статусом «прочитал» и датой окончания в нужном периоде;
 *  - страницы — сумма страниц этих книг (или прогресс для недочитанных);
 *  - серия дней — сколько дней подряд есть хоть одна запись (старт — сегодня);
 *  - темп — среднее число страниц в день за период с первой до последней записи;
 *  - любимые жанры — группировка прочитанного по жанрам.
 *
 * Всё это специально проверяется тестами на заранее посчитанных данных,
 * чтобы «Книжный год» нельзя было незаметно сломать.
 */

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** Границы периода: год целиком или произвольный отрезок. */
function yearRange(year) {
  const value = Number(year) || new Date().getFullYear();
  return { start: new Date(Date.UTC(value, 0, 1)), end: new Date(Date.UTC(value + 1, 0, 1)), year: value };
}

/** Ключ дня в формате ГГГГ-ММ-ДД (UTC, чтобы не зависеть от часового пояса). */
function dayKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

/**
 * Самый длинный период подряд и текущая серия.
 * Принимает массив ключей дней (может повторяться) и «сегодня».
 */
function streaks(days, today = new Date()) {
  const unique = [...new Set(days.map(dayKey))].sort();
  if (!unique.length) return { current: 0, longest: 0 };

  let longest = 1;
  let run = 1;
  for (let i = 1; i < unique.length; i += 1) {
    const prev = new Date(`${unique[i - 1]}T00:00:00Z`);
    const next = new Date(`${unique[i]}T00:00:00Z`);
    const diff = Math.round((next - prev) / 86400000);
    run = diff === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  // Текущая серия: считаем назад от сегодня; если сегодня записи нет — от вчера
  const set = new Set(unique);
  const cursor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  if (!set.has(dayKey(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 1);

  let current = 0;
  while (set.has(dayKey(cursor)) && current < 4000) {
    current += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return { current, longest };
}

function createStatsService({ LibraryEntry, Book, Review, ReadingGoal, sequelize }) {
  const sql = sequelize || LibraryEntry.sequelize || Book.sequelize;

  /** Итоги за период: книги, страницы, оценки, темп. */
  async function summary({ userId, year = null, from = null, to = null } = {}) {
    const range = year ? yearRange(year) : {
      start: from ? new Date(from) : new Date(Date.UTC(new Date().getFullYear(), 0, 1)),
      end: to ? new Date(to) : new Date(Date.UTC(new Date().getFullYear() + 1, 0, 1)),
      year: year || new Date().getFullYear()
    };

    const entries = await LibraryEntry.findAll({
      where: { userId, status: { [Op.in]: ['read', 'reading', 'dnf'] } },
      include: [{ model: Book, as: 'book', attributes: ['id', 'pages', 'title', 'author'] }],
      order: [['updatedAt', 'DESC']]
    });

    const finished = entries.filter((entry) => (
      entry.status === 'read'
      && entry.finishedAt
      && new Date(entry.finishedAt) >= range.start
      && new Date(entry.finishedAt) < range.end
    ));

    const booksRead = finished.length;
    const pagesRead = finished.reduce((sum, entry) => sum + (Number(entry.book?.pages) || 0), 0);

    // Дни, когда были действия с книгами: отметки прогресса и закрытие книг
    const activityDays = entries
      .filter((entry) => (
        (entry.updatedAt >= range.start && entry.updatedAt < range.end)
        || (entry.finishedAt && new Date(entry.finishedAt) >= range.start && new Date(entry.finishedAt) < range.end)
      ))
      .map((entry) => entry.updatedAt);

    const marks = streaks(activityDays);

    const ratings = await Review.findAll({
      attributes: ['rating'],
      where: { userId, state: 'published' },
      raw: true
    });
    const averageRating = ratings.length
      ? Math.round((ratings.reduce((sum, row) => sum + Number(row.rating), 0) / ratings.length / 2) * 10) / 10
      : 0;

    // Темп: страницы делим на дни от первой до последней записи периода (минимум 1 день)
    const sortedDays = [...new Set(activityDays.map(dayKey))].sort();
    const spanDays = sortedDays.length > 1
      ? Math.round((new Date(`${sortedDays[sortedDays.length - 1]}T00:00:00Z`) - new Date(`${sortedDays[0]}T00:00:00Z`)) / 86400000) + 1
      : 1;
    const pace = pagesRead ? Math.round((pagesRead / spanDays) * 10) / 10 : 0;

    return {
      year: range.year,
      booksRead,
      pagesRead,
      reviews: ratings.length,
      averageRating,
      daysActive: sortedDays.length,
      currentStreak: marks.current,
      longestStreak: marks.longest,
      pace,
      finished
    };
  }

  /** Любимые жанры прочитанного: топ-5 с числом книг. */
  async function topGenres(userId, year = new Date().getFullYear()) {
    const range = yearRange(year);
    const rows = await sql.query(
      `SELECT g.name AS name, g.slug AS slug, COUNT(*) AS total
         FROM library_entries le
         JOIN books b ON b.id = le.book_id
         JOIN book_genres bg ON bg.book_id = b.id
         JOIN genres g ON g.id = bg.genre_id
        WHERE le.user_id = :userId
          AND le.status = 'read'
          AND le.finished_at >= :start AND le.finished_at < :end
        GROUP BY g.name, g.slug
        ORDER BY COUNT(*) DESC, g.name ASC
        LIMIT 5`,
      { replacements: { userId, start: range.start, end: range.end }, type: sql.QueryTypes.SELECT }
    );

    return rows.map((row) => ({ name: row.name, slug: row.slug, count: Number(row.total) }));
  }

  /** Карта активности: сколько действий в каждый день года (для «как GitHub»). */
  async function activityMap(userId, year = new Date().getFullYear()) {
    const range = yearRange(year);
    const rows = await LibraryEntry.findAll({
      attributes: ['updatedAt'],
      where: {
        userId,
        updatedAt: { [Op.gte]: range.start, [Op.lt]: range.end }
      },
      raw: true
    });

    const counts = new Map();
    for (const row of rows) {
      const key = dayKey(row.updatedAt);
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    // Все дни года по порядку: 0 — пусто, 1–4 — уровень для отрисовки
    const weeks = [];
    const first = new Date(Date.UTC(year, 0, 1));
    const last = new Date(Date.UTC(year + 1, 0, 1));
    for (let cursor = new Date(first); cursor < last; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const key = dayKey(cursor);
      const count = counts.get(key) || 0;
      weeks.push({
        date: key,
        count,
        level: count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : count <= 6 ? 3 : 4
      });
    }

    const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
    return { days: weeks, total };
  }

  /** Разбивка по месяцам: сколько книг закончено в каждом. */
  async function byMonth(userId, year = new Date().getFullYear()) {
    const range = yearRange(year);
    const rows = await LibraryEntry.findAll({
      attributes: ['finishedAt'],
      where: {
        userId,
        status: 'read',
        finishedAt: { [Op.gte]: range.start, [Op.lt]: range.end }
      },
      raw: true
    });

    const counts = new Array(12).fill(0);
    for (const row of rows) {
      const month = new Date(row.finishedAt).getUTCMonth();
      counts[month] += 1;
    }
    return counts.map((count, index) => ({ month: index + 1, label: MONTHS_SHORT[index], count }));
  }

  /** Всё для страницы «Книжный год» — один набор вызовов. */
  async function yearInBooks(userId, year = new Date().getFullYear()) {
    const [totals, genres, months, map, goal] = await Promise.all([
      summary({ userId, year }),
      topGenres(userId, year),
      byMonth(userId, year),
      activityMap(userId, year),
      ReadingGoal.findOne({ where: { userId, year } })
    ]);

    return {
      year: totals.year,
      totals: {
        booksRead: totals.booksRead,
        pagesRead: totals.pagesRead,
        reviews: totals.reviews,
        averageRating: totals.averageRating,
        currentStreak: totals.currentStreak,
        longestStreak: totals.longestStreak,
        pace: totals.pace,
        daysActive: totals.daysActive
      },
      genres,
      months,
      map,
      goal: goal ? { target: goal.targetBooks, finished: totals.booksRead } : null,
      books: totals.finished.map((entry) => ({
        title: entry.book?.title || '',
        author: entry.book?.author || '',
        pages: Number(entry.book?.pages) || 0,
        finishedAt: entry.finishedAt
      }))
    };
  }

  /** Раньше можно ли смотреть чужой «Книжный год»: только если профиль открыт. */
  async function achievements(userId, year = new Date().getFullYear()) {
    const totals = await summary({ userId, year });
    const list = [];

    const add = (key, title, hint, unlocked) => list.push({ key, title, hint, unlocked: Boolean(unlocked) });

    add('first-book', 'Первая книга', 'Закрыть первую книгу за год', totals.booksRead >= 1);
    add('five-books', 'Пять книг', 'Прочитать 5 книг за год', totals.booksRead >= 5);
    add('ten-books', 'Десятка', 'Прочитать 10 книг за год', totals.booksRead >= 10);
    add('twenty-five', 'Двадцать пять', 'Прочитать 25 книг за год', totals.booksRead >= 25);
    add('fifty-books', 'Пятьдесят', 'Прочитать 50 книг за год', totals.booksRead >= 50);
    add('thousand-pages', 'Тысяча страниц', 'Прочитать 1000 страниц', totals.pagesRead >= 1000);
    add('ten-thousand', 'Десять тысяч', 'Прочитать 10 000 страниц', totals.pagesRead >= 10000);
    add('week-streak', 'Неделя подряд', 'Отмечать чтение 7 дней подряд', totals.currentStreak >= 7 || totals.longestStreak >= 7);
    add('month-streak', 'Месяц подряд', 'Отмечать чтение 30 дней подряд', totals.currentStreak >= 30 || totals.longestStreak >= 30);
    add('reviewer', 'Рецензент', 'Написать 5 рецензий', totals.reviews >= 5);
    add('critic', 'Критик', 'Написать 20 рецензий', totals.reviews >= 20);
    add('generous', 'Щедрый на оценки', 'Средняя оценка выше 4.5', totals.averageRating >= 4.5 && totals.reviews >= 3);
    add('steady', 'Ровный темп', '20 страниц в день и больше', totals.pace >= 20);

    return list;
  }

  return { summary, topGenres, activityMap, byMonth, yearInBooks, achievements, streaks, MONTHS_SHORT };
}

module.exports = { createStatsService, streaks, yearRange, dayKey, MONTHS_SHORT };
