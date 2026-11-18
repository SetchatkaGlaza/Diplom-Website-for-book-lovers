'use strict';

const { Op } = require('sequelize');

/**
 * Оценки и рецензии.
 *
 * Правила:
 *  - одна рецензия на книгу от человека (уникальный индекс), оценка живёт вместе с ней;
 *  - оценка хранится половинными шагами 2–10 (7 = 3.5★), наружу отдаётся в звёздах;
 *  - средняя оценка и счётчики на книге пересчитываются после каждого изменения,
 *    а не считаются на каждый показ страницы;
 *  - спойлер не отдаётся в HTML целиком: сервер режет текст на «безопасную» часть
 *    и остаток, который виден только после нажатия «показать»;
 *  - скрытая модератором рецензия не влияет на среднюю оценку;
 *  - текст рецензии — от 20 до 20000 знаков, комментарий — от 2 до 4000.
 */

const REVIEW_MIN = 20;
const REVIEW_MAX = 20000;
const COMMENT_MIN = 2;
const COMMENT_MAX = 4000;
const PAGE_SIZE = 10;

/** Половинные шаги: 3.5★ → 7. Возвращает null, если шаг не тот. */
function toRatingValue(stars) {
  const value = Number(stars);
  if (!Number.isFinite(value) || value < 1 || value > 5) return null;
  const doubled = Math.round(value * 2);
  if (Math.abs(value * 2 - doubled) > 1e-9) return null;
  return doubled;
}

/** Обратно: 7 → 3.5 */
function toStars(rating) {
  return (Number(rating) || 0) / 2;
}

/**
 * Разрезает текст со спойлером на видимую часть и остаток.
 * Видимая часть намеренно короткая (70 знаков, первая фраза):
 * этого хватает, чтобы понять тему, но сюжет по ней не узнать.
 */
function splitSpoiler(body, limit = 70) {
  const text = String(body || '');
  if (!text) return { intro: '', rest: '' };

  const paragraph = (text.split(/\n\s*\n/)[0] || text).trim();
  if (paragraph.length <= limit) {
    const rest = text.slice(text.indexOf(paragraph) + paragraph.length).replace(/^\s+/, '');
    return { intro: paragraph, rest };
  }
  // Режем по границе слова, чтобы не рвать слово пополам
  const cut = text.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  const at = space > 30 ? space : limit;
  return { intro: `${text.slice(0, at).trimEnd()}…`, rest: text.slice(at).trim() };
}

function createReviewService({ Review, Book, ReviewLike, ReviewComment, LibraryEntry, Activity, sequelize }) {
  const sql = sequelize || Book.sequelize;

  /**
   * Пересчитывает агрегаты книги: среднюю оценку, число оценок и рецензий.
   * Считаем в базе одним запросом и записываем готовые числа.
   */
  async function recountBook(bookId) {
    const [row] = await Review.findAll({
      attributes: [
        [sql.literal('COUNT(*)'), 'total'],
        [sql.literal('COALESCE(SUM(rating), 0)'), 'sum']
      ],
      where: { bookId, state: 'published' },
      raw: true
    });

    const count = Number(row.total) || 0;
    const sum = Number(row.sum) || 0;
    await Book.update({ ratingsCount: count, ratingsSum: sum, reviewsCount: count }, { where: { id: bookId } });
    return { count, sum };
  }

  /** Готовая к показу рецензия: звёзды, автор, спойлер разрезан. */
  function toView(review, { viewerId = null, likedIds = new Set() } = {}) {
    const plain = review.get ? review.get({ plain: true }) : review;
    const user = plain.user || {};
    const spoiler = plain.hasSpoilers ? splitSpoiler(plain.body) : null;

    return {
      id: plain.id,
      rating: toStars(plain.rating),
      ratingRaw: plain.rating,
      title: plain.title || '',
      body: plain.hasSpoilers ? spoiler.intro : plain.body,
      spoilerRest: plain.hasSpoilers ? spoiler.rest : '',
      hasSpoilers: Boolean(plain.hasSpoilers),
      likesCount: Number(plain.likesCount) || 0,
      commentsCount: Number(plain.commentsCount) || 0,
      liked: likedIds.has(plain.id),
      isOwn: viewerId !== null && plain.userId === viewerId,
      createdAt: plain.createdAt,
      user: {
        id: user.id,
        name: user.name || 'Читатель'
      }
    };
  }

  /** Рецензии книги: последние сверху, по 10 на страницу. */
  async function listForBook(bookId, { page = 1, viewerId = null, sort = 'new' } = {}) {
    const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
    const order = sort === 'rating'
      ? [['rating', 'DESC'], ['createdAt', 'DESC']]
      : [['createdAt', 'DESC']];

    const total = await Review.count({ where: { bookId, state: 'published' } });
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const rows = await Review.findAll({
      where: { bookId, state: 'published' },
      include: [{ association: 'user', attributes: ['id', 'name'] }],
      order,
      limit: PAGE_SIZE,
      offset: (Math.min(safePage, pages) - 1) * PAGE_SIZE
    });

    const likedIds = await likesOf(viewerId, rows.map((row) => row.id));

    return {
      items: rows.map((row) => toView(row, { viewerId, likedIds })),
      total,
      page: Math.min(safePage, pages),
      pages,
      sort
    };
  }

  async function likesOf(viewerId, reviewIds) {
    if (!viewerId || !reviewIds.length) return new Set();
    const rows = await ReviewLike.findAll({
      attributes: ['reviewId'],
      where: { userId: viewerId, reviewId: { [Op.in]: reviewIds } },
      raw: true
    });
    return new Set(rows.map((row) => row.reviewId));
  }

  /** Рецензия человека на эту книгу (для формы «редактировать»). */
  async function ownReview(userId, bookId) {
    if (!userId) return null;
    const review = await Review.findOne({ where: { userId, bookId } });
    return review ? toView(review, { viewerId: userId }) : null;
  }

  /**
   * Создать или обновить рецензию. Возвращает { review } или { error }.
   * Оценка приходит в звёздах (1–5 с шагом 0.5).
   */
  async function save({ userId, bookId, rating, title = '', body, hasSpoilers = false }) {
    const ratingRaw = toRatingValue(rating);
    if (ratingRaw === null) return { error: 'Оценка: от 1 до 5 с шагом 0.5' };

    const text = String(body || '').trim();
    if (text.length < REVIEW_MIN) return { error: `Рецензия: минимум ${REVIEW_MIN} знаков` };
    if (text.length > REVIEW_MAX) return { error: `Рецензия: максимум ${REVIEW_MAX} знаков` };

    const book = await Book.findByPk(bookId);
    if (!book) return { error: 'Книга не найдена' };

    const [review, created] = await Review.findOrCreate({
      where: { userId, bookId },
      defaults: {
        userId,
        bookId,
        rating: ratingRaw,
        title: String(title || '').trim().slice(0, 160),
        body: text,
        hasSpoilers: Boolean(hasSpoilers),
        state: 'published'
      }
    });

    if (!created) {
      await review.update({
        rating: ratingRaw,
        title: String(title || '').trim().slice(0, 160),
        body: text,
        hasSpoilers: Boolean(hasSpoilers)
      });
    }

    await recountBook(bookId);

    // Книга сама попадает на полку в статус «прочитал»: оценка без полки не имеет смысла
    try {
      const [entry] = await LibraryEntry.findOrCreate({
        where: { userId, bookId },
        defaults: { userId, bookId, status: 'read', startedAt: new Date(), finishedAt: new Date(), progressPages: book.pages || 0 }
      });
      if (entry.status !== 'read') {
        await entry.update({ status: 'read', finishedAt: entry.finishedAt || new Date() });
      }
    } catch (error) {
      // Полка — вспомогательная запись: рецензия уже сохранена
    }

    // Лента активности: одна запись на рецензию, чтобы не дублировать при правках
    try {
      await Activity.findOrCreate({
        where: { userId, bookId, reviewId: review.id, kind: 'review' },
        defaults: { userId, bookId, reviewId: review.id, kind: 'review' }
      });
    } catch (error) {
      // Лента не должна ломать сохранение
    }

    return { review: toView(review, { viewerId: userId }), created };
  }

  async function remove({ userId, reviewId, isModerator = false }) {
    const review = await Review.findByPk(reviewId);
    if (!review) return { error: 'Рецензия не найдена' };
    if (review.userId !== userId && !isModerator) return { error: 'Это не ваша рецензия' };

    const bookId = review.bookId;
    await review.destroy();
    await recountBook(bookId);
    return { removed: true };
  }

  /** Лайк: второй раз — снимаем. Возвращает новое число лайков. */
  async function toggleLike({ userId, reviewId }) {
    const review = await Review.findByPk(reviewId);
    if (!review) return { error: 'Рецензия не найдена' };

    // Гонка: два быстрых клика не должны превращаться в «поставил и сразу снял».
    // Сначала пробуем найти существующий лайк; создаём только если его нет,
    // а уникальный индекс на (review_id, user_id) страхует от дубля.
    const existing = await ReviewLike.findOne({ where: { reviewId, userId } });
    let created = false;

    if (existing) {
      await existing.destroy();
    } else {
      try {
        await ReviewLike.create({ reviewId, userId });
        created = true;
      } catch (error) {
        // Соседний запрос успел создать лайк: считаем, что он уже есть
        created = false;
      }
    }

    const likesCount = await ReviewLike.count({ where: { reviewId } });
    await review.update({ likesCount });

    return { liked: created, likesCount };
  }

  async function listComments(reviewId) {
    const rows = await ReviewComment.findAll({
      where: { reviewId, state: 'published' },
      include: [{ association: 'user', attributes: ['id', 'name'] }],
      order: [['createdAt', 'ASC']],
      limit: 100
    });
    return rows.map((row) => ({
      id: row.id,
      body: row.body,
      createdAt: row.createdAt,
      user: { id: row.user.id, name: row.user.name || 'Читатель' }
    }));
  }

  async function addComment({ userId, reviewId, body }) {
    const text = String(body || '').trim();
    if (text.length < COMMENT_MIN) return { error: 'Комментарий: минимум 2 знака' };
    if (text.length > COMMENT_MAX) return { error: `Комментарий: максимум ${COMMENT_MAX} знаков` };

    const review = await Review.findByPk(reviewId);
    if (!review) return { error: 'Рецензия не найдена' };

    const comment = await ReviewComment.create({ reviewId, userId, body: text });
    const commentsCount = await ReviewComment.count({ where: { reviewId, state: 'published' } });
    await review.update({ commentsCount });

    return { comment: { id: comment.id, body: comment.body, createdAt: comment.createdAt }, commentsCount };
  }

  return {
    listForBook,
    ownReview,
    save,
    remove,
    toggleLike,
    listComments,
    addComment,
    recountBook,
    toView,
    LIMITS: { REVIEW_MIN, REVIEW_MAX, COMMENT_MIN, COMMENT_MAX, PAGE_SIZE }
  };
}

module.exports = {
  createReviewService,
  toRatingValue,
  toStars,
  splitSpoiler,
  REVIEW_MIN,
  REVIEW_MAX,
  COMMENT_MIN,
  COMMENT_MAX
};
