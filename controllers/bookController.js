const { Book, Genre, Review, User, UserBook, sequelize } = require('../models');
const { Op } = require('sequelize'); // Операторы для сложных запросов
const { getAvatarUrl, getCoverUrl } = require('../utils/imageUrls');
const { validateSearchQuery } = require('../utils/validators');

const BOOKS_PER_PAGE = 12;
const BOOKS_PER_PAGE_TABLET = 10;
const BOOKS_PER_PAGE_MOBILE = 8;
const REVIEWS_PER_BOOK_PAGE = 3;
const FALLBACK_MIN_YEAR = 1000;
const CURRENT_YEAR = new Date().getFullYear();

const getSingleQueryValue = (value, fallback = '') => {
  if (Array.isArray(value)) {
    return value.find((item) => item !== undefined && item !== null && item !== '') || fallback;
  }

  return value || fallback;
};

const SORT_OPTIONS = {
  newest: [['createdAt', 'DESC'], ['id', 'DESC']],
  popular: [['views_count', 'DESC'], ['createdAt', 'DESC'], ['id', 'DESC']],
  title_asc: [['title', 'ASC'], ['author', 'ASC'], ['id', 'ASC']],
  title_desc: [['title', 'DESC'], ['author', 'DESC'], ['id', 'DESC']],
  year_desc: [['year', 'DESC NULLS LAST'], ['createdAt', 'DESC'], ['id', 'DESC']],
  year_asc: [['year', 'ASC NULLS LAST'], ['createdAt', 'DESC'], ['id', 'DESC']],
  rating: [[sequelize.literal('average_rating'), 'DESC'], [sequelize.literal('approved_reviews_count'), 'DESC'], ['createdAt', 'DESC'], ['id', 'DESC']]
};

exports.getCatalog = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const userAgent = req.get('user-agent') || '';
    const isMobile = /iphone|ipod|android.+mobile|windows phone|blackberry/i.test(userAgent);
    const isTablet = /ipad|tablet|android(?!.*mobile)/i.test(userAgent);

    let limit = BOOKS_PER_PAGE;
    if (isMobile) {
      limit = BOOKS_PER_PAGE_MOBILE;
    } else if (isTablet) {
      limit = BOOKS_PER_PAGE_TABLET;
    }

    if (req.query.perPage) {
      const requestedLimit = parseInt(req.query.perPage, 10);
      if (!Number.isNaN(requestedLimit) && requestedLimit >= 4 && requestedLimit <= BOOKS_PER_PAGE) {
        limit = requestedLimit;
      }
    }

    const offset = (page - 1) * limit;
    const sort = getSingleQueryValue(req.query.sort, 'newest');
    const selectedSort = SORT_OPTIONS[sort] ? sort : 'newest';
    const oldestBookYearRaw = await Book.min('year', {
      where: {
        year: { [Op.ne]: null }
      }
    });
    const minCatalogYear = Number.isFinite(Number(oldestBookYearRaw))
      ? Number(oldestBookYearRaw)
      : FALLBACK_MIN_YEAR;
    const filterWarnings = [];

    const filters = {};
    const filtersForView = {};

    const genre = getSingleQueryValue(req.query.genre);
    if (genre) {
      filters.genre_id = genre;
      filtersForView.genre = genre;
    }

    const authorValidation = validateSearchQuery(getSingleQueryValue(req.query.author), 'Фильтр автора');
    if (authorValidation.error) {
      filterWarnings.push(authorValidation.error);
    }
    const author = authorValidation.error ? '' : authorValidation.value;
    if (author) {
      filters.author = { [Op.iLike]: `%${author}%` };
      filtersForView.author = author;
    }

    const yearFromRaw = getSingleQueryValue(req.query.year_from);
    const yearToRaw = getSingleQueryValue(req.query.year_to);
    let yearFrom = parseInt(yearFromRaw, 10);
    let yearTo = parseInt(yearToRaw, 10);

    if (!Number.isNaN(yearFrom) && yearFrom < minCatalogYear) {
      filterWarnings.push(`Минимальный год в каталоге – ${minCatalogYear}. Поиск начат с этого года.`);
      yearFrom = minCatalogYear;
    }

    if (!Number.isNaN(yearTo) && yearTo < minCatalogYear) {
      filterWarnings.push(`Год «до» не может быть меньше ${minCatalogYear}. Значение скорректировано.`);
      yearTo = minCatalogYear;
    }

    if (!Number.isNaN(yearFrom) && !Number.isNaN(yearTo) && yearFrom > yearTo) {
      filterWarnings.push('Год «от» был больше года «до», поэтому значения поменяны местами.');
      [yearFrom, yearTo] = [yearTo, yearFrom];
    }

    if (!Number.isNaN(yearFrom) || !Number.isNaN(yearTo)) {
      filters.year = {};
      if (!Number.isNaN(yearFrom)) {
        filters.year[Op.gte] = yearFrom;
        filtersForView.year_from = String(yearFrom);
      }
      if (!Number.isNaN(yearTo)) {
        filters.year[Op.lte] = yearTo;
        filtersForView.year_to = String(yearTo);
      }
    }

    const searchValidation = validateSearchQuery(getSingleQueryValue(req.query.search), 'Поисковый запрос');
    if (searchValidation.error) {
      filterWarnings.push(searchValidation.error);
    }
    const search = searchValidation.error ? '' : searchValidation.value;
    if (search) {
      filters[Op.or] = [
        { title: { [Op.iLike]: `%${search}%` } },
        { author: { [Op.iLike]: `%${search}%` } }
      ];
      filtersForView.search = search;
    }

    const hasActiveFilters = Object.keys(filtersForView).length > 0;

    const { count, rows: books } = await Book.findAndCountAll({
      where: filters,
      attributes: {
        include: [
          [sequelize.literal('(SELECT COALESCE(AVG("rating"), 0) FROM "Reviews" WHERE "Reviews"."book_id" = "Book"."id" AND "Reviews"."is_moderated" = true)'), 'average_rating'],
          [sequelize.literal('(SELECT COUNT(*) FROM "Reviews" WHERE "Reviews"."book_id" = "Book"."id" AND "Reviews"."is_moderated" = true)'), 'approved_reviews_count']
        ]
      },
      include: [
        {
          model: Genre,
          as: 'genre',
          attributes: ['id', 'name']
        }
      ],
      order: SORT_OPTIONS[selectedSort],
      limit,
      offset,
      distinct: true // важно для правильного подсчёта при include
    });
    
    const genres = await Genre.findAll({
      order: [['name', 'ASC']]
    });
    
    const booksWithRating = books.map((book) => {
      const bookData = book.toJSON();
      const averageRating = Number(bookData.average_rating || 0).toFixed(1);

      return {
        ...bookData,
        averageRating: parseFloat(averageRating),
        coverUrl: getCoverUrl(book.cover_image, book.cover_public_id)
      };
    });
    
    res.render('books/catalog', {
      title: 'Каталог книг',
      books: booksWithRating,
      genres,
      currentPage: page,
      totalPages: Math.ceil(count / limit),
      totalBooks: count,
      filters: filtersForView,
      hasActiveFilters,
      filterWarnings,
      minCatalogYear,
      maxCatalogYear: CURRENT_YEAR,
      sort: selectedSort,
      user: req.session.user || null
    });
    
  } catch (error) {
    console.error('Ошибка при загрузке каталога:', error);
    req.flash('error', 'Произошла ошибка при загрузке каталога');
    res.redirect('/');
  }
};

exports.getBookById = async (req, res) => {
  try {
    const bookId = req.params.id;
    
    const book = await Book.findByPk(bookId, {
      include: [
        {
          model: Genre,
          as: 'genre',
          attributes: ['id', 'name']
        }
      ]
    });
    
    if (!book) {
      req.flash('error', 'Книга не найдена');
      return res.redirect('/books');
    }
    
    await book.incrementViews();
    
    const ratingInfo = await book.getRatingInfo();
    
    const reviewsPage = Math.max(parseInt(req.query.reviewsPage, 10) || 1, 1);
    const reviewsOffset = (reviewsPage - 1) * REVIEWS_PER_BOOK_PAGE;

    const reviewVisibilityWhere = {
      book_id: bookId,
      ...(req.session.user
        ? {
          [Op.or]: [
            { is_moderated: true },
            { user_id: req.session.user.id }
          ]
        }
        : { is_moderated: true })
    };

    const { count: reviewsCount, rows: reviews } = await Review.findAndCountAll({
      where: reviewVisibilityWhere,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'avatar', 'avatar_public_id']
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: REVIEWS_PER_BOOK_PAGE,
      offset: reviewsOffset
    });
    
    let userBookStatus = null;
    let userReview = null;
    
    if (req.session.user) {
      const UserBook = require('../models/UserBook');
      
      const userBook = await UserBook.findOne({
        where: {
          user_id: req.session.user.id,
          book_id: bookId
        }
      });
      
      if (userBook) {
        userBookStatus = userBook.status;
      }
      
      userReview = await Review.findOne({
        where: {
          user_id: req.session.user.id,
          book_id: bookId
        }
      });
    }
    
    const similarBooks = await Book.findAll({
      where: {
        genre_id: book.genre_id,
        id: { [Op.ne]: bookId } // исключаем текущую книгу
      },
      include: [
        {
          model: Genre,
          as: 'genre',
          attributes: ['id', 'name']
        }
      ],
      limit: 6,
      order: [['views_count', 'DESC']]
    });
    
    const similarBooksWithRating = await Promise.all(
      similarBooks.map(async (similarBook) => {
        const rating = await similarBook.getAverageRating();
        return {
          ...similarBook.toJSON(),
          averageRating: rating,
          coverUrl: getCoverUrl(similarBook.cover_image, similarBook.cover_public_id)
        };
      })
    );
    
    res.render('books/show', {
  title: book.title,
  book: {
    ...book.toJSON(),
    averageRating: ratingInfo.average,
    coverUrl: getCoverUrl(book.cover_image, book.cover_public_id)
  },
  ratingInfo,
  reviews: reviews.map((review) => ({ ...review.toJSON(), user: { ...review.user.toJSON(), avatarUrl: getAvatarUrl(review.user.avatar, review.user.avatar_public_id) } })),
  similarBooks: similarBooksWithRating,
  userBookStatus,
  userReview,
  user: req.session.user || null,
  reviewsPagination: {
    currentPage: reviewsPage,
    totalPages: Math.ceil(reviewsCount / REVIEWS_PER_BOOK_PAGE),
    totalReviews: reviewsCount
  }
});
    
  } catch (error) {
    console.error('Ошибка при загрузке книги:', error);
    req.flash('error', 'Произошла ошибка при загрузке книги');
    res.redirect('/books');
  }
};

exports.searchBooks = async (req, res) => {
  try {
    const queryValidation = validateSearchQuery(req.query.q || '', 'Поисковый запрос');
    const query = queryValidation.value;
    
    if (queryValidation.error || !query || query.length < 2) {
      return res.json([]);
    }
    
    const books = await Book.findAll({
      where: {
        [Op.or]: [
          { title: { [Op.iLike]: `%${query}%` } },
          { author: { [Op.iLike]: `%${query}%` } }
        ]
      },
      include: [
        {
          model: Genre,
          as: 'genre',
          attributes: ['name']
        }
      ],
      limit: 10
    });
    
    const booksWithRating = await Promise.all(
      books.map(async (book) => {
        const ratingInfo = await book.getRatingInfo();
        return {
          id: book.id,
          title: book.title,
          author: book.author,
          cover: book.cover_image,
          cover_public_id: book.cover_public_id,
          coverUrl: getCoverUrl(book.cover_image, book.cover_public_id),
          genre: book.genre ? book.genre.name : 'Без жанра',
          year: book.year,
          rating: ratingInfo.average
        };
      })
    );
    
    res.json(booksWithRating);
    
  } catch (error) {
    console.error('Ошибка при поиске:', error);
    res.status(500).json({ error: 'Ошибка при поиске' });
  }
};

exports.getPopularBooks = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 8;
    
    const books = await Book.findAll({
      include: [
        {
          model: Genre,
          as: 'genre',
          attributes: ['name']
        }
      ],
      order: [['views_count', 'DESC']],
      limit
    });
    
    const booksWithRating = await Promise.all(
  books.map(async (book) => {
    const ratingInfo = await book.getRatingInfo();
    return {
      ...book.toJSON(),
      averageRating: ratingInfo.average,
      ratingsCount: ratingInfo.count,
      coverUrl: getCoverUrl(book.cover_image, book.cover_public_id)
    };
  })
);
    
    res.json(booksWithRating);
    
  } catch (error) {
    console.error('Ошибка при получении популярных книг:', error);
    res.status(500).json({ error: 'Ошибка при загрузке' });
  }
};

exports.getRandomBook = async (req, res) => {
  try {
    const count = await Book.count();
    
    if (count === 0) {
      return res.json(null);
    }
    
    const randomOffset = Math.floor(Math.random() * count);
    
    const book = await Book.findOne({
      offset: randomOffset,
      include: [
        {
          model: Genre,
          as: 'genre',
          attributes: ['name']
        }
      ]
    });
    
    const rating = await book.getAverageRating();
    
    res.json({
      id: book.id,
      title: book.title,
      author: book.author,
      cover: book.cover_image,
      cover_public_id: book.cover_public_id,
      coverUrl: getCoverUrl(book.cover_image, book.cover_public_id),
      description: book.description ? book.description.substring(0, 200) + '...' : '',
      genre: book.genre ? book.genre.name : 'Без жанра',
      year: book.year,
      rating
    });
    
  } catch (error) {
    console.error('Ошибка при получении случайной книги:', error);
    res.status(500).json({ error: 'Ошибка при загрузке' });
  }
};
