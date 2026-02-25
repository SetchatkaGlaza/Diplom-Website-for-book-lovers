const { Book, Genre, Review, User } = require('../models');
const { Op } = require('sequelize'); // Операторы для сложных запросов

/**
 * Количество книг на одной странице
 */
const BOOKS_PER_PAGE = 12;

/**
 * 1. ПОКАЗ КАТАЛОГА КНИГ (с фильтрацией, сортировкой, пагинацией)
 */
exports.getCatalog = async (req, res) => {
  try {
    // Получаем параметры из запроса
    const page = parseInt(req.query.page) || 1;
    const limit = BOOKS_PER_PAGE;
    const offset = (page - 1) * limit;
    
    // Фильтры
    const filters = {};
    
    // Фильтр по жанру
    if (req.query.genre) {
      filters.genre_id = req.query.genre;
    }
    
    // Фильтр по автору (частичное совпадение)
    if (req.query.author) {
      filters.author = { [Op.iLike]: `%${req.query.author}%` }; // iLike = регистронезависимый поиск
    }
    
    // Фильтр по году (диапазон)
    if (req.query.year_from || req.query.year_to) {
      filters.year = {};
      if (req.query.year_from) {
        filters.year[Op.gte] = parseInt(req.query.year_from);
      }
      if (req.query.year_to) {
        filters.year[Op.lte] = parseInt(req.query.year_to);
      }
    }
    
    // Поиск по названию
    if (req.query.search) {
  filters[Op.or] = [
    { title: { [Op.iLike]: `%${req.query.search}%` } },
    { author: { [Op.iLike]: `%${req.query.search}%` } }
  ];
}
    
    // Сортировка
    let order = [];
    switch (req.query.sort) {
      case 'title_asc':
        order = [['title', 'ASC']];
        break;
      case 'title_desc':
        order = [['title', 'DESC']];
        break;
      case 'year_desc':
        order = [['year', 'DESC']];
        break;
      case 'year_asc':
        order = [['year', 'ASC']];
        break;
      case 'popular':
        order = [['views_count', 'DESC']];
        break;
      case 'rating':
        // Сортировка по рейтингу сложнее, пока сортируем по дате добавления
        order = [['createdAt', 'DESC']];
        break;
      default:
        order = [['createdAt', 'DESC']]; // по умолчанию новые сначала
    }
    
    // Выполняем запрос с пагинацией
    const { count, rows: books } = await Book.findAndCountAll({
      where: filters,
      include: [
        {
          model: Genre,
          as: 'genre',
          attributes: ['id', 'name']
        }
      ],
      order,
      limit,
      offset,
      distinct: true // важно для правильного подсчёта при include
    });
    
    // Получаем все жанры для фильтра
    const genres = await Genre.findAll({
      order: [['name', 'ASC']]
    });
    
    // Для каждой книги получаем средний рейтинг
    const booksWithRating = await Promise.all(
      books.map(async (book) => {
        const rating = await book.getAverageRating();
        return {
          ...book.toJSON(),
          averageRating: rating
        };
      })
    );
    
    // Рендерим страницу
    res.render('books/catalog', {
      title: 'Каталог книг',
      books: booksWithRating,
      genres,
      currentPage: page,
      totalPages: Math.ceil(count / limit),
      totalBooks: count,
      filters: req.query,
      sort: req.query.sort || 'newest',
      user: req.session.user || null
    });
    
  } catch (error) {
    console.error('Ошибка при загрузке каталога:', error);
    req.flash('error', 'Произошла ошибка при загрузке каталога');
    res.redirect('/');
  }
};

/**
 * 2. ПОКАЗ ОДНОЙ КНИГИ (по ID)
 */
exports.getBookById = async (req, res) => {
  try {
    const bookId = req.params.id;
    
    // Ищем книгу с жанром
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
    
    // Увеличиваем счётчик просмотров
    await book.incrementViews();
    
    // Получаем средний рейтинг
    const averageRating = await book.getAverageRating();
    
    // Получаем рецензии к книге с информацией о пользователях
    const reviews = await Review.findAll({
      where: { book_id: bookId },
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'avatar']
        }
      ],
      order: [['createdAt', 'DESC']]
    });
    
    // Проверяем, есть ли книга в полках текущего пользователя
    let userBookStatus = null;
    let userReview = null;
    
    if (req.session.user) {
      const UserBook = require('../models/UserBook');
      
      // Статус книги для пользователя
      const userBook = await UserBook.findOne({
        where: {
          user_id: req.session.user.id,
          book_id: bookId
        }
      });
      
      if (userBook) {
        userBookStatus = userBook.status;
      }
      
      // Рецензия пользователя на эту книгу
      userReview = await Review.findOne({
        where: {
          user_id: req.session.user.id,
          book_id: bookId
        }
      });
    }
    
    // Получаем похожие книги (по тому же жанру)
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
    
    // Добавляем рейтинг для похожих книг
    const similarBooksWithRating = await Promise.all(
      similarBooks.map(async (similarBook) => {
        const rating = await similarBook.getAverageRating();
        return {
          ...similarBook.toJSON(),
          averageRating: rating
        };
      })
    );
    
    res.render('books/show', {
      title: book.title,
      book: {
        ...book.toJSON(),
        averageRating
      },
      reviews,
      similarBooks: similarBooksWithRating,
      userBookStatus,
      userReview,
      user: req.session.user || null
    });
    
  } catch (error) {
    console.error('Ошибка при загрузке книги:', error);
    req.flash('error', 'Произошла ошибка при загрузке книги');
    res.redirect('/books');
  }
};

/**
 * 3. ПОИСК КНИГ (AJAX для быстрого поиска на главной)
 */
exports.searchBooks = async (req, res) => {
  try {
    const query = req.query.q;
    
    if (!query || query.length < 2) {
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
    
    // Добавляем рейтинг к результатам
    const booksWithRating = await Promise.all(
      books.map(async (book) => {
        const rating = await book.getAverageRating();
        return {
          id: book.id,
          title: book.title,
          author: book.author,
          cover: book.cover_image,
          genre: book.genre ? book.genre.name : 'Без жанра',
          year: book.year,
          rating
        };
      })
    );
    
    res.json(booksWithRating);
    
  } catch (error) {
    console.error('Ошибка при поиске:', error);
    res.status(500).json({ error: 'Ошибка при поиске' });
  }
};

/**
 * 4. ПОЛУЧЕНИЕ ПОПУЛЯРНЫХ КНИГ (для главной)
 */
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
        const rating = await book.getAverageRating();
        return {
          ...book.toJSON(),
          averageRating: rating
        };
      })
    );
    
    res.json(booksWithRating);
    
  } catch (error) {
    console.error('Ошибка при получении популярных книг:', error);
    res.status(500).json({ error: 'Ошибка при загрузке' });
  }
};

/**
 * 5. ПОЛУЧЕНИЕ СЛУЧАЙНОЙ КНИГИ
 */
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