'use strict';

const { Op, literal } = require('sequelize');
const { uniqueSlug } = require('../lib/slug');

/**
 * Каталог книг: поиск, фильтры, сортировки, карточка книги.
 *
 * Правила, которые здесь закреплены:
 *  - поиск идёт по названию и автору, регистр не важен, несколько слов
 *    складываются по «И» (нашёл «мастер булгаков» → «Мастер и Маргарита»);
 *  - сортировки только из белого списка, иначе в ORDER BY попадёт мусор;
 *  - наружу книги отдаются без служебных полей, а средняя оценка считается
 *    из агрегатов ratings_sum / ratings_count (без запроса на каждую книгу);
 *  - слаг уникален и делается из «автор + название».
 */

const SORTS = {
  popular: {
    label: 'Сначала популярные',
    order: [['shelves_count', 'DESC'], ['ratings_count', 'DESC'], ['title', 'ASC']]
  },
  rating: {
    label: 'По оценке',
    order: [['rating_avg', 'DESC'], ['ratings_count', 'DESC'], ['title', 'ASC']]
  },
  new: {
    label: 'Сначала новые',
    order: [['created_at', 'DESC'], ['id', 'DESC']]
  },
  year: {
    label: 'По году издания',
    order: [['year', 'DESC'], ['title', 'ASC']]
  },
  title: {
    label: 'По названию',
    order: [['title', 'ASC']]
  }
};

/**
 * Средняя оценка: сумма баллов делится на их количество.
 * ratingsSummary хранит сумму в половинных шагах (9 = 4.5 звезды),
 * поэтому перед делением переводим в звёзды и округляем до десятых.
 */
const RATING_AVG_SQL = '(CASE WHEN ratings_count > 0 THEN (ratings_sum / 2.0) / ratings_count ELSE 0 END)';

const DEFAULT_SORT = 'popular';
const PAGE_SIZE = 24;
const MAX_PAGE = 200;

function pickSort(value) {
  return Object.prototype.hasOwnProperty.call(SORTS, value) ? value : DEFAULT_SORT;
}

function parsePage(value) {
  const page = Number.parseInt(value, 10);
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(page, MAX_PAGE);
}

/** Разбивает строку поиска на слова и вычищает мусор. */
function parseQuery(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
    // % и _ в LIKE — служебные символы, экранируем
    .replace(/[%_\\]/g, ' ')
    .split(' ')
    .filter((word) => word.length > 0)
    .slice(0, 6);
}

function createCatalogService({ Book, Genre, LibraryEntry, Review }) {
  /** Средняя оценка из агрегатов + приведение строк к обычным числам. */
  function decorate(book) {
    const plain = typeof book.get === 'function' ? book.get({ plain: true }) : { ...book };
    const ratingsCount = Number(plain.ratingsCount) || 0;
    // Сумма баллов хранится в половинных шагах (9 = 4.5 звезды), поэтому делим на два
    const ratingsSum = (Number(plain.ratingsSum) || 0) / 2;
    return {
      id: plain.id,
      slug: plain.slug,
      title: plain.title,
      author: plain.author,
      description: plain.description || '',
      year: plain.year || null,
      pages: plain.pages || null,
      publisher: plain.publisher || null,
      isbn: plain.isbn || null,
      cover: plain.cover || 'default-cover.svg',
      ratingsCount,
      reviewsCount: Number(plain.reviewsCount) || 0,
      shelvesCount: Number(plain.shelvesCount) || 0,
      viewsCount: Number(plain.viewsCount) || 0,
      rating: ratingsCount ? Math.round((ratingsSum / ratingsCount) * 10) / 10 : 0,
      genres: plain.genres || []
    };
  }

  /** Условие поиска: каждое слово должно встретиться в названии или авторе. */
  function buildSearchWhere(words) {
    if (!words.length) return {};
    const and = words.map((word) => {
      const like = { [Op.iLike]: `%${word}%` };
      return { [Op.or]: [{ title: like }, { author: like }] };
    });
    return { [Op.and]: and };
  }

  async function list(options = {}) {
    const page = parsePage(options.page);
    const sort = pickSort(options.sort);
    const words = parseQuery(options.query);
    const genreSlug = String(options.genre || '').trim().slice(0, 60);

    const where = { isPublished: true, ...buildSearchWhere(words) };

    // Жанр: если фильтр по жанру задан, нужен отдельный запрос по связке
    let bookIdsByGenre = null;
    if (genreSlug) {
      const genre = await Genre.findOne({ where: { slug: genreSlug } });
      if (!genre) {
        return {
          items: [], total: 0, page: 1, pages: 0, pageSize: PAGE_SIZE,
          sort, query: words.join(' '), genreSlug, genreMissing: true
        };
      }
      const links = await Book.findAll({
        attributes: ['id'],
        include: [{ model: Genre, as: 'genres', attributes: [], where: { id: genre.id }, through: { attributes: [] } }]
      });
      bookIdsByGenre = links.map((row) => row.id);
      if (!bookIdsByGenre.length) {
        return {
          items: [], total: 0, page: 1, pages: 0, pageSize: PAGE_SIZE,
          sort, query: words.join(' '), genreSlug, genreMissing: false
        };
      }
      where.id = { [Op.in]: bookIdsByGenre };
    }

    const total = await Book.count({ where });
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const safePage = Math.min(page, pages);

    const attributes = {
      include: [[literal(RATING_AVG_SQL), 'rating_avg']]
    };

    const rows = await Book.findAll({
      where,
      attributes,
      order: sort === 'rating'
        ? [[literal('ratings_count'), 'DESC'], ['title', 'ASC']]
        : SORTS[sort].order,
      limit: PAGE_SIZE,
      offset: (safePage - 1) * PAGE_SIZE
    });

    return {
      items: rows.map(decorate),
      total,
      page: safePage,
      pages,
      pageSize: PAGE_SIZE,
      sort,
      query: words.join(' '),
      genreSlug,
      genreMissing: false
    };
  }

  async function allGenres() {
    const genres = await Genre.findAll({
      attributes: ['id', 'name', 'slug'],
      order: [['sortOrder', 'ASC'], ['name', 'ASC']]
    });
    return genres.map((genre) => genre.get({ plain: true }));
  }

  /** Жанры с количеством книг — для полосы фильтров. */
  async function genresWithCounts() {
    const genres = await Genre.findAll({
      attributes: {
        include: [[literal('(SELECT COUNT(*) FROM book_genres bg JOIN books b ON b.id = bg.book_id WHERE bg.genre_id = "Genre"."id" AND b.is_published)'), 'books_count']]
      },
      order: [['sortOrder', 'ASC'], ['name', 'ASC']]
    });
    return genres.map((genre) => {
      const plain = genre.get({ plain: true });
      return { ...plain, booksCount: Number(plain.books_count) || 0 };
    });
  }

  /** Карточка книги: жанры, кто читает, рецензии (последние 5). */
  async function findBySlug(slug) {
    const book = await Book.findOne({
      where: { slug: String(slug || '') },
      include: [{ model: Genre, as: 'genres', attributes: ['id', 'name', 'slug'], through: { attributes: [] } }]
    });
    if (!book || !book.isPublished) return null;

    const [reading, read, want, reviews] = await Promise.all([
      LibraryEntry.count({ where: { bookId: book.id, status: 'reading' } }),
      LibraryEntry.count({ where: { bookId: book.id, status: 'read' } }),
      LibraryEntry.count({ where: { bookId: book.id, status: 'want' } }),
      Review.findAll({
        where: { bookId: book.id, state: 'published' },
        include: [{ association: 'user', attributes: ['id', 'name', 'avatar'] }],
        order: [['createdAt', 'DESC']],
        limit: 5
      })
    ]);

    const card = decorate(book);
    return {
      book: card,
      genres: card.genres.map((genre) => ({ id: genre.id, name: genre.name, slug: genre.slug })),
      counts: { reading, read, want },
      reviews: reviews.map((review) => ({
        id: review.id,
        rating: review.getStars(),
        title: review.title,
        body: review.body,
        hasSpoilers: review.hasSpoilers,
        createdAt: review.createdAt,
        user: {
          id: review.user?.id,
          name: review.user?.name || 'Читатель'
        }
      }))
    };
  }

  /** Книги того же автора и того же жанра — без самой книги. */
  async function similar(bookId, limit = 8) {
    const book = await Book.findByPk(bookId, {
      include: [{ model: Genre, as: 'genres', attributes: ['id'], through: { attributes: [] } }]
    });
    if (!book) return { byAuthor: [], byGenre: [] };

    const byAuthor = (await Book.findAll({
      where: { isPublished: true, author: book.author, id: { [Op.ne]: book.id } },
      order: [['shelves_count', 'DESC']],
      limit
    })).map(decorate);

    const genreIds = (book.genres || []).map((genre) => genre.id);
    let byGenre = [];
    if (genreIds.length) {
      const rows = await Book.findAll({
        where: { isPublished: true, id: { [Op.ne]: book.id } },
        include: [{
          model: Genre, as: 'genres', attributes: [], through: { attributes: [] },
          where: { id: { [Op.in]: genreIds } }, required: true
        }],
        order: [[literal('shelves_count'), 'DESC']],
        limit,
        group: ['Book.id'],
        subQuery: false
      });
      byGenre = rows
        .filter((row) => !byAuthor.some((item) => item.id === row.id))
        .map(decorate);
    }

    return { byAuthor, byGenre };
  }

  /**
   * Новая книга от читателя. Без поля «обложка» — карточка рисует заглушку
   * с названием, пока обложку не поставили.
   */
  async function create(data) {
    const title = String(data.title || '').trim();
    const author = String(data.author || '').trim();
    if (!title || !author) return { error: 'Нужны название и автор' };

    const slug = await uniqueSlug(
      `${author} ${title}`,
      async (candidate) => Boolean(await Book.count({ where: { slug: candidate } })),
      'kniga'
    );

    const book = await Book.create({
      slug,
      title,
      author,
      description: String(data.description || '').trim().slice(0, 4000),
      year: data.year || null,
      pages: data.pages || null,
      publisher: data.publisher ? String(data.publisher).trim().slice(0, 160) : null,
      isbn: data.isbn || null,
      createdByUserId: data.userId || null,
      cover: 'default-cover.svg'
    });

    const genreIds = Array.isArray(data.genreIds) ? data.genreIds.filter(Boolean).slice(0, 5) : [];
    if (genreIds.length) {
      // Связь пишется через модель того же инстанса Sequelize, что и книга
      const linkModel = Book.sequelize.models.BookGenre;
      for (const genreId of genreIds) {
        await linkModel.findOrCreate({ where: { bookId: book.id, genreId } });
      }
    }

    return { book: decorate(book) };
  }

  /** Счётчик просмотров: одна единица на открытие карточки. */
  async function countView(bookId) {
    await Book.increment({ viewsCount: 1 }, { where: { id: bookId } });
  }

  return {
    list,
    findBySlug,
    similar,
    create,
    allGenres,
    genresWithCounts,
    countView,
    decorate,
    picks: { pickSort, parsePage, parseQuery },
    SORTS,
    DEFAULT_SORT,
    PAGE_SIZE
  };
}

module.exports = { createCatalogService, SORTS, DEFAULT_SORT, PAGE_SIZE, pickSort, parsePage, parseQuery };
