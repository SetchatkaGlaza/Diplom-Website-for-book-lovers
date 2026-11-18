'use strict';

const { Op } = require('sequelize');

/**
 * Цифры для владельца: сколько людей пришло, сколько вернулось, что читают.
 *
 * Считаем по базе, а не по счётчикам в памяти: после рестарта счётчики
 * обнуляются, а вопрос «сколько у нас читателей» остаётся.
 *
 * Возврат (retention) считаем честно и грубо одновременно: человек считается
 * вернувшимся, если у него есть действие сегодня и было действие 7+ дней назад.
 * Точная когортная аналитика на таких объёмах не нужна, а этот показатель
 * нельзя «накрутить» регистрацией.
 */
function createAdminService({ User, Book, LibraryEntry, Review, Activity, sequelize }) {
  /**
   * Имя колонки в базе, а не имя поля в модели.
   * Sequelize переводит camelCase в snake_case, и в сыром SQL нужно второе.
   */
  function columnOf(Model, attribute) {
    const definition = (Model.rawAttributes && Model.rawAttributes[attribute])
      || (Model.getAttributes && Model.getAttributes()[attribute])
      || {};
    return definition.field || attribute;
  }

  /** Сколько записей появилось за последние N дней. */
  async function dailyCount(Model, days, { column = 'createdAt' } = {}) {
    const from = new Date(Date.now() - days * 24 * 3600 * 1000);
    const dbColumn = columnOf(Model, column);
    const [rows] = await sequelize.query(
      `SELECT to_char(date_trunc('day', "${dbColumn}"), 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
         FROM "${Model.getTableName()}"
        WHERE "${dbColumn}" >= :from
        GROUP BY 1 ORDER BY 1`,
      { replacements: { from } }
    );
    const byDay = new Map(rows.map((row) => [row.day, Number(row.count)]));
    return Array.from({ length: days }, (_, index) => {
      const date = new Date(Date.now() - (days - 1 - index) * 24 * 3600 * 1000);
      const key = date.toISOString().slice(0, 10);
      return { day: key, count: byDay.get(key) || 0 };
    });
  }

  /** Сводка: читатели, активность, книги. Один вызов — один экран. */
  async function overview({ days = 14 } = {}) {
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);

    const [
      users, newUsersWeek, newUsersMonth, blockedUsers,
      books, publishedBooks, entries, reviews,
      activeWeek, registrations, entriesSeries, reviewsSeries
    ] = await Promise.all([
      User.count({ where: { deletedAt: null } }),
      User.count({ where: { createdAt: { [Op.gte]: weekAgo }, deletedAt: null } }),
      User.count({ where: { createdAt: { [Op.gte]: monthAgo }, deletedAt: null } }),
      User.count({ where: { isBlocked: true } }),
      Book.count(),
      Book.count({ where: { isPublished: true } }),
      LibraryEntry.count(),
      Review.count(),
      User.count({ where: { lastActiveAt: { [Op.gte]: weekAgo }, deletedAt: null } }),
      dailyCount(User, days),
      dailyCount(LibraryEntry, days),
      dailyCount(Review, days)
    ]);

    // Возвраты: пришёл на этой неделе и был раньше — значит, вернулся
    const returnedUsers = await User.count({
      where: {
        lastActiveAt: { [Op.gte]: weekAgo },
        createdAt: { [Op.lt]: weekAgo },
        deletedAt: null
      }
    });

    const [topBooks] = await sequelize.query(
      `SELECT b.title, b.author, COUNT(le.id)::int AS readers,
              COUNT(*) FILTER (WHERE le.status = 'read')::int AS finished
         FROM library_entries le
         JOIN books b ON b.id = le.book_id
        GROUP BY b.id, b.title, b.author
        ORDER BY readers DESC
        LIMIT 10`
    );

    const [genreShare] = await sequelize.query(
      `SELECT g.name, COUNT(le.id)::int AS readers
         FROM library_entries le
         JOIN book_genres bg ON bg.book_id = le.book_id
         JOIN genres g ON g.id = bg.genre_id
        GROUP BY g.name
        ORDER BY readers DESC
        LIMIT 8`
    );

    return {
      users: {
        total: users,
        newWeek: newUsersWeek,
        newMonth: newUsersMonth,
        blocked: blockedUsers,
        activeWeek,
        returnedWeek: returnedUsers,
        // Доля вернувшихся от тех, кто зарегистрировался раньше недели
        retentionWeek: users > 0 ? Math.round((returnedUsers / Math.max(1, users - newUsersWeek)) * 100) : 0
      },
      catalog: { books, publishedBooks },
      activity: { entries, reviews, perReader: users ? Math.round((entries / users) * 10) / 10 : 0 },
      series: { registrations, entries: entriesSeries, reviews: reviewsSeries },
      topBooks,
      genreShare
    };
  }

  /**
   * Воронка активации: регистрация → добавил книгу → дочитал → написал рецензию.
   *
   * Зачем отдельно от «сколько всего читателей»: общее число растёт от любой
   * рекламы, а воронка показывает, где люди останавливаются. Если из 100
   * зарегистрированных 90 дошли до полки и 12 до рецензии — проблема не
   * в привлечении, а в том, что происходит после первой книги.
   *
   * Считаем по когортам «за последние N дней», а не по всей истории: старая
   * история сглаживает провал и он перестаёт быть виден.
   */
  async function funnel({ days = 30 } = {}) {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);

    const [registered, withShelfRow, finished, reviewed] = await Promise.all([
      User.count({ where: { createdAt: { [Op.gte]: since }, deletedAt: null } }),
      sequelize.query(
        `SELECT COUNT(DISTINCT le.user_id)::int AS count
           FROM library_entries le JOIN users u ON u.id = le.user_id
          WHERE u.created_at >= :since AND u.deleted_at IS NULL`,
        { replacements: { since }, type: sequelize.QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT COUNT(DISTINCT le.user_id)::int AS count
           FROM library_entries le JOIN users u ON u.id = le.user_id
          WHERE u.created_at >= :since AND u.deleted_at IS NULL AND le.status = 'read'`,
        { replacements: { since }, type: sequelize.QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT COUNT(DISTINCT r.user_id)::int AS count
           FROM reviews r JOIN users u ON u.id = r.user_id
          WHERE u.created_at >= :since AND u.deleted_at IS NULL AND r.state = 'published'`,
        { replacements: { since }, type: sequelize.QueryTypes.SELECT }
      )
    ]);

    const steps = [
      { key: 'registered', title: 'Зарегистрировались', count: registered },
      { key: 'shelf', title: 'Добавили книгу на полку', count: withShelfRow[0]?.count || 0 },
      { key: 'finished', title: 'Дочитали хотя бы одну', count: finished[0]?.count || 0 },
      { key: 'reviewed', title: 'Написали рецензию', count: reviewed[0]?.count || 0 }
    ].map((step, index, all) => ({
      ...step,
      // Доля от предыдущего шага: именно она показывает, где провал
      fromPrevious: index === 0 ? 100 : Math.round((step.count / Math.max(1, all[index - 1].count)) * 100),
      fromStart: Math.round((step.count / Math.max(1, registered)) * 100)
    }));

    return { days, steps, registered };
  }

  /**
   * Где люди уходят: последний шаг, который человек сделал.
   *
   * «Зарегистрировался и исчез» и «добавил книгу и исчез» требуют разных
   * правок: в первом случае не сработал первый экран, во втором — полка.
   * Смотрим на тех, кто молчит дольше недели, иначе цифра шумит новичками.
   */
  async function dropoff({ days = 30, silentForDays = 7 } = {}) {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const silentSince = new Date(Date.now() - silentForDays * 24 * 3600 * 1000);

    const [rows] = await sequelize.query(
      `WITH cohort AS (
         SELECT u.id
           FROM users u
          WHERE u.created_at >= :since AND u.deleted_at IS NULL
            AND (u.last_active_at IS NULL OR u.last_active_at < :silentSince)
       ),
       last_step AS (
         SELECT c.id,
                CASE
                  WHEN EXISTS (SELECT 1 FROM reviews r WHERE r.user_id = c.id AND r.state = 'published') THEN 'reviewed'
                  WHEN EXISTS (SELECT 1 FROM library_entries le WHERE le.user_id = c.id AND le.status = 'read') THEN 'finished'
                  WHEN EXISTS (SELECT 1 FROM library_entries le WHERE le.user_id = c.id) THEN 'shelf'
                  ELSE 'registered'
                END AS step
           FROM cohort c
       )
       SELECT step, COUNT(*)::int AS count FROM last_step GROUP BY step`,
      { replacements: { since, silentSince } }
    );

    const byStep = new Map(rows.map((row) => [row.step, Number(row.count)]));
    const total = rows.reduce((sum, row) => sum + Number(row.count), 0);
    const labels = {
      registered: 'Зарегистрировался и ушёл',
      shelf: 'Добавил книгу и ушёл',
      finished: 'Дочитал книгу и ушёл',
      reviewed: 'Написал рецензию и ушёл'
    };
    const hints = {
      registered: 'Первый экран не убеждает: человек не понял, что делать дальше',
      shelf: 'Полка есть, но до чтения не дошло: возможно, мешает выбор книги',
      finished: 'Дочитал, но не поделился: нет повода написать рецензию',
      reviewed: 'Сделал всё и не вернулся: нет причины заходить регулярно'
    };

    return {
      days,
      silentForDays,
      total,
      steps: ['registered', 'shelf', 'finished', 'reviewed'].map((step) => ({
        step,
        title: labels[step],
        hint: hints[step],
        count: byStep.get(step) || 0,
        share: total ? Math.round(((byStep.get(step) || 0) / total) * 100) : 0
      }))
    };
  }

  /**
   * Что делать владельцу: короткий список дел, который сам себя проверяет.
   * Возвращает пары «что не так» → «куда смотреть», без оценок и паники.
   */
  async function checklist({ mailTransportKind = 'console', publicUrl = '' } = {}) {
    const items = [];

    const booksWithoutDescription = await Book.count({
      where: { description: { [Op.or]: [null, ''] } }
    });
    if (booksWithoutDescription > 0) {
      items.push({
        level: 'warn',
        title: `У ${booksWithoutDescription} книг нет описания`,
        hint: 'Карточки без описания плохо индексируются: /admin не покажет их людям первыми',
        action: 'Заполнить на этапе наполнения'
      });
    }

    const booksWithoutReviews = await sequelize.query(
      `SELECT COUNT(*)::int AS count FROM books b
        WHERE b.is_published = true
          AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.book_id = b.id)`,
      { type: sequelize.QueryTypes.SELECT }
    );
    const lonely = booksWithoutReviews[0]?.count || 0;
    if (lonely > 0) {
      items.push({
        level: 'info',
        title: `${lonely} книг без единой рецензии`,
        hint: 'Первые читатели не находят, что обсудить. Помогают подборки и рецензии редакции',
        action: 'Наполнение'
      });
    }

    if (mailTransportKind === 'console') {
      items.push({
        level: 'error',
        title: 'Почта не настроена',
        hint: 'Регистрация и сброс пароля не работают: письма уходят только в лог',
        action: 'RESEND_API_KEY или SMTP_HOST'
      });
    }

    if (!publicUrl || publicUrl.includes('localhost')) {
      items.push({
        level: 'error',
        title: 'PUBLIC_URL указывает на localhost',
        hint: 'Ссылки в письмах и canonical ведут не туда',
        action: 'Задать PUBLIC_URL с настоящим доменом'
      });
    }

    const admins = await User.count({ where: { role: 'admin', deletedAt: null } });
    if (admins < 2) {
      items.push({
        level: 'warn',
        title: admins === 0 ? 'Нет ни одного администратора' : 'Администратор один',
        hint: 'Если единственный админ потеряет доступ, управлять сайтом будет некому',
        action: 'Назначить второго админа'
      });
    }

    const visibleReviews = await Review.count({ where: { state: 'published' } });
    if (visibleReviews === 0) {
      items.push({
        level: 'info',
        title: 'На сайте пока нет ни одной видимой рецензии',
        hint: 'Пустой сайт не убеждает нового читателя остаться',
        action: 'Наполнение'
      });
    }

    return items;
  }

  return { overview, funnel, dropoff, checklist };
}

module.exports = { createAdminService };
