// controllers/adminController.js
const { User, Book, Genre, Review, UserBook, sequelize } = require('../models');
const { Op } = require('sequelize');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs').promises;
const notificationService = require('../services/notificationService');

const SALT_ROUNDS = 10;

/**
 * 1. ДАШБОРД (главная страница админки)
 */
exports.getDashboard = async (req, res) => {
  try {
    // Основная статистика
    const stats = {
      totalUsers: await User.count(),
      totalBooks: await Book.count(),
      totalReviews: await Review.count(),
      totalGenres: await Genre.count(),
      
      // Новые за сегодня
      newUsersToday: await User.count({
        where: {
          createdAt: {
            [Op.gte]: new Date(new Date().setHours(0, 0, 0, 0))
          }
        }
      }),
      
      newBooksToday: await Book.count({
        where: {
          createdAt: {
            [Op.gte]: new Date(new Date().setHours(0, 0, 0, 0))
          }
        }
      }),
      
      newReviewsToday: await Review.count({
        where: {
          createdAt: {
            [Op.gte]: new Date(new Date().setHours(0, 0, 0, 0))
          }
        }
      })
    };
    
    // Статистика по ролям (ИСПРАВЛЕНО)
    const rolesStatsRaw = await User.findAll({
      attributes: [
        'role',
        [sequelize.fn('COUNT', sequelize.col('role')), 'count']
      ],
      group: ['role']
    });
    
    // Преобразуем данные для графика
    const rolesStats = rolesStatsRaw.map(stat => ({
      role: stat.role,
      count: parseInt(stat.dataValues.count)
    }));
    
    // Если нет данных, добавляем пустой массив
    const formattedRolesStats = rolesStats.length > 0 ? rolesStats : [];
    
    // Последние пользователи
    const recentUsers = await User.findAll({
      attributes: ['id', 'name', 'email', 'role', 'avatar', 'createdAt'],
      order: [['createdAt', 'DESC']],
      limit: 5
    });
    
    // Последние книги
    const recentBooks = await Book.findAll({
      include: [{ model: Genre, as: 'genre', attributes: ['name'] }],
      order: [['createdAt', 'DESC']],
      limit: 5
    });
    
    // Последние рецензии
    const recentReviews = await Review.findAll({
      include: [
        { 
          model: User, 
          as: 'user', 
          attributes: ['id', 'name', 'avatar'] 
        },
        { 
          model: Book, 
          as: 'book', 
          attributes: ['id', 'title', 'cover_image'] 
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: 5
    });
    
    res.render('admin/dashboard', {
      title: 'Админ-панель',
      layout: 'layouts/admin',
      currentPage: 'dashboard',
      stats,
      rolesStats: formattedRolesStats,
      recentUsers,
      recentBooks,
      recentReviews,
      user: req.session.user
    });
    
  } catch (error) {
    console.error('Ошибка при загрузке дашборда:', error);
    req.flash('error', 'Произошла ошибка при загрузке дашборда');
    res.redirect('/');
  }
};

/**
 * 2. УПРАВЛЕНИЕ КНИГАМИ (список)
 */
exports.getBooks = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    
    // Поиск по названию или автору
    const where = search ? {
      [Op.or]: [
        { title: { [Op.iLike]: `%${search}%` } },
        { author: { [Op.iLike]: `%${search}%` } }
      ]
    } : {};
    
    const { count, rows: books } = await Book.findAndCountAll({
      where,
      include: [{ model: Genre, as: 'genre', attributes: ['id', 'name'] }],
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });
    
    // Дополнительная информация для каждой книги
    const booksWithStats = await Promise.all(
      books.map(async (book) => {
        const reviewsCount = await Review.count({ where: { book_id: book.id } });
        const avgRating = await book.getAverageRating();
        const inUserBooks = await UserBook.count({ where: { book_id: book.id } });
        
        return {
          ...book.toJSON(),
          reviewsCount,
          avgRating,
          inUserBooks
        };
      })
    );
    
    res.render('admin/books/index', {
      title: 'Управление книгами',
      layout: 'layouts/admin',
      currentPage: 'books',
      books: booksWithStats,
      search,
      currentPage: page,
      totalPages: Math.ceil(count / limit),
      totalBooks: count,
      user: req.session.user
    });
    
  } catch (error) {
    console.error('Ошибка при загрузке списка книг:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/admin');
  }
};

/**
 * 3. ДОБАВЛЕНИЕ КНИГИ (форма)
 */
exports.getAddBook = async (req, res) => {
  try {
    const genres = await Genre.findAll({ order: [['name', 'ASC']] });
    
    res.render('admin/books/add', {
      title: 'Добавление книги',
      layout: 'layouts/admin',
      currentPage: 'books',
      genres,
      errors: [],
      formData: {},
      user: req.session.user
    });
    
  } catch (error) {
    console.error('Ошибка при загрузке формы:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/admin/books');
  }
};

/**
 * 4. ДОБАВЛЕНИЕ КНИГИ (обработка)
 */
exports.postAddBook = async (req, res) => {
  try {
    const {
      title, author, description, year, pages,
      publisher, genre_id, isbn
    } = req.body;
    
    // Валидация
    const errors = [];
    
    if (!title || title.length < 1) {
      errors.push({ msg: 'Название обязательно' });
    }
    
    if (!author || author.length < 2) {
      errors.push({ msg: 'Автор обязателен' });
    }
    
    if (year && (year < 1000 || year > new Date().getFullYear() + 1)) {
      errors.push({ msg: 'Некорректный год' });
    }
    
    if (errors.length > 0) {
      const genres = await Genre.findAll({ order: [['name', 'ASC']] });
      return res.render('admin/books/add', {
        title: 'Добавление книги',
        layout: 'layouts/admin',
        currentPage: 'books',
        genres,
        errors,
        formData: req.body,
        user: req.session.user
      });
    }
    
    // Обработка загрузки обложки
    let cover_image = 'default-book-cover.jpg';

if (req.file) {
  cover_image = req.file.filename;
}
    
    // Создаём книгу
    await Book.create({
      title,
      author,
      description,
      year: year || null,
      pages: pages || null,
      publisher: publisher || null,
      genre_id: genre_id || null,
      cover_image,
      isbn: isbn || null
    });
    
    req.flash('success', 'Книга успешно добавлена');
    res.redirect('/admin/books');
    
  } catch (error) {
    console.error('Ошибка при добавлении книги:', error);
    req.flash('error', 'Произошла ошибка при добавлении книги');
    res.redirect('/admin/books/add');
  }
};

/**
 * 5. РЕДАКТИРОВАНИЕ КНИГИ (форма)
 */
exports.getEditBook = async (req, res) => {
  try {
    const bookId = req.params.id;
    
    const book = await Book.findByPk(bookId, {
      include: [{ model: Genre, as: 'genre' }]
    });
    
    if (!book) {
      req.flash('error', 'Книга не найдена');
      return res.redirect('/admin/books');
    }
    
    const genres = await Genre.findAll({ order: [['name', 'ASC']] });
    
    res.render('admin/books/edit', {
      title: 'Редактирование книги',
      layout: 'layouts/admin',
      currentPage: 'books',
      book,
      genres,
      errors: [],
      user: req.session.user
    });
    
  } catch (error) {
    console.error('Ошибка при загрузке формы:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/admin/books');
  }
};

/**
 * 6. РЕДАКТИРОВАНИЕ КНИГИ (обработка)
 */
exports.postEditBook = async (req, res) => {
  try {
    const bookId = req.params.id;
    const {
      title, author, description, year, pages,
      publisher, genre_id, isbn
    } = req.body;
    
    // Находим книгу
    const book = await Book.findByPk(bookId);
    
    if (!book) {
      req.flash('error', 'Книга не найдена');
      return res.redirect('/admin/books');
    }
    
    // Валидация
    const errors = [];
    
    if (!title || title.length < 1) {
      errors.push({ msg: 'Название обязательно' });
    }
    
    if (!author || author.length < 2) {
      errors.push({ msg: 'Автор обязателен' });
    }
    
    if (year && (year < 1000 || year > new Date().getFullYear() + 1)) {
      errors.push({ msg: 'Некорректный год' });
    }
    
    if (errors.length > 0) {
      const genres = await Genre.findAll({ order: [['name', 'ASC']] });
      return res.render('admin/books/edit', {
        title: 'Редактирование книги',
        book: { ...book.toJSON(), ...req.body },
        genres,
        errors
      });
    }
    
    // Подготовка данных для обновления
    const updateData = {
      title,
      author,
      description,
      year: year || null,
      pages: pages || null,
      publisher: publisher || null,
      genre_id: genre_id || null,
      isbn: isbn || null
    };
    
    // Если загружена новая обложка
if (req.file) {
  // Удаляем старую обложку, ТОЛЬКО если она не является заглушкой
  const isDefaultCover = book.cover_image === 'default-book-cover.jpg' || 
                         book.cover_image === 'default-book-cover.svg';
  
  if (book.cover_image && !isDefaultCover) {
    const oldCoverPath = path.join(__dirname, '../public/images/covers', book.cover_image);
    try {
      // Проверяем существование файла перед удалением
      try {
        await fs.access(oldCoverPath);
        await fs.unlink(oldCoverPath);
        console.log(`✅ Удалён старый файл: ${book.cover_image}`);
      } catch (err) {
        if (err.code === 'ENOENT') {
          console.log(`⚠️ Файл не найден (возможно уже удалён): ${book.cover_image}`);
        } else {
          console.log(`❌ Ошибка при удалении: ${err.message}`);
        }
      }
    } catch (err) {
      console.log(`⚠️ Не удалось проверить файл: ${err.message}`);
    }
  } else if (isDefaultCover) {
    console.log(`ℹ️ Пропускаем удаление заглушки: ${book.cover_image}`);
  }
  
  updateData.cover_image = req.file.filename;
}
    
    // Обновляем книгу
    await book.update(updateData);
    
    req.flash('success', 'Книга успешно обновлена');
    res.redirect('/admin/books');
    
  } catch (error) {
    console.error('❌ Ошибка при обновлении книги:', error);
    req.flash('error', 'Произошла ошибка при обновлении книги');
    res.redirect(`/admin/books/${req.params.id}/edit`);
  }
};

/**
 * 7. УДАЛЕНИЕ КНИГИ
 */
exports.deleteBook = async (req, res) => {
  try {
    const bookId = req.params.id;
    
    const book = await Book.findByPk(bookId);
    
    if (!book) {
      req.flash('error', 'Книга не найдена');
      return res.redirect('/admin/books');
    }
    
    // Удаляем обложку, если она не стандартная
    if (book.cover_image && book.cover_image !== 'default-book-cover.jpg') {
      const coverPath = path.join(__dirname, '../public/images/covers', book.cover_image);
      try {
        await fs.unlink(coverPath);
      } catch (err) {
        console.log('Не удалось удалить обложку:', err.message);
      }
    }
    
    // Удаляем все связанные записи
    await Review.destroy({ where: { book_id: bookId } });
    await UserBook.destroy({ where: { book_id: bookId } });
    
    // Удаляем книгу
    await book.destroy();
    
    req.flash('success', 'Книга успешно удалена');
    res.redirect('/admin/books');
    
  } catch (error) {
    console.error('Ошибка при удалении книги:', error);
    req.flash('error', 'Произошла ошибка при удалении книги');
    res.redirect('/admin/books');
  }
};

/**
 * 8. УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ
 */
exports.getUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const role = req.query.role || 'all';
    
    // Поиск
    const where = {};
    
    if (search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } }
      ];
    }
    
    if (role !== 'all') {
      where.role = role;
    }
    
    const { count, rows: users } = await User.findAndCountAll({
      where,
      attributes: { exclude: ['password_hash'] },
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });
    
    // Статистика по пользователям
    const usersWithStats = await Promise.all(
      users.map(async (user) => {
        const booksCount = await UserBook.count({ where: { user_id: user.id } });
        const reviewsCount = await Review.count({ where: { user_id: user.id } });
        
        return {
          ...user.toJSON(),
          booksCount,
          reviewsCount
        };
      })
    );
    
    // Статистика по ролям для фильтра
    const roleStats = await User.findAll({
      attributes: ['role', [sequelize.fn('COUNT', sequelize.col('role')), 'count']],
      group: ['role']
    });
    
    res.render('admin/users/index', {
      title: 'Управление пользователями',
      layout: 'layouts/admin',
      currentPage: 'users',
      users: usersWithStats,
      roleStats,
      search,
      currentRole: role,
      currentPage: page,
      totalPages: Math.ceil(count / limit),
      totalUsers: count,
      errors: [],
      user: req.session.user
    });
    
  } catch (error) {
    console.error('Ошибка при загрузке пользователей:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/admin');
  }
};

/**
 * 9. ИЗМЕНЕНИЕ РОЛИ ПОЛЬЗОВАТЕЛЯ
 */
exports.updateUserRole = async (req, res) => {
  try {
    const userId = req.params.id;
    const { role } = req.body;
    
    // Проверяем, что роль допустима
    const allowedRoles = ['user', 'moderator', 'admin'];
    if (!allowedRoles.includes(role)) {
      req.flash('error', 'Недопустимая роль');
      return res.redirect('/admin/users');
    }
    
    // Не даём изменить роль суперадмина (самого себя)
    if (userId == req.session.user.id && role !== 'admin') {
      req.flash('error', 'Вы не можете понизить свою роль');
      return res.redirect('/admin/users');
    }
    
    const user = await User.findByPk(userId);
    
    if (!user) {
      req.flash('error', 'Пользователь не найден');
      return res.redirect('/admin/users');
    }
    
    await user.update({ role });
    
    req.flash('success', `Роль пользователя ${user.name} изменена на ${role}`);
    res.redirect('/admin/users');
    
  } catch (error) {
    console.error('Ошибка при изменении роли:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/admin/users');
  }
};

/**
 * 10. БЛОКИРОВКА/РАЗБЛОКИРОВКА ПОЛЬЗОВАТЕЛЯ
 */
exports.toggleUserBlock = async (req, res) => {
  try {
    const userId = req.params.id;
    
    // Не даём заблокировать самого себя
    if (userId == req.session.user.id) {
      req.flash('error', 'Вы не можете заблокировать самого себя');
      return res.redirect('/admin/users');
    }
    
    const user = await User.findByPk(userId);
    
    if (!user) {
      req.flash('error', 'Пользователь не найдена');
      return res.redirect('/admin/users');
    }
    
    // Временно используем поле isBlocked (если его нет в модели, нужно добавить)
    // Для простоты будем использовать флаг в статусе
    await user.update({ 
      isBlocked: user.isBlocked ? false : true 
    });
    
    const action = user.isBlocked ? 'заблокирован' : 'разблокирован';
    req.flash('success', `Пользователь ${user.name} ${action}`);
    res.redirect('/admin/users');
    
  } catch (error) {
    console.error('Ошибка при блокировке пользователя:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/admin/users');
  }
};

/**
 * 11. УПРАВЛЕНИЕ ЖАНРАМИ
 */
exports.getGenres = async (req, res) => {
  try {
    const genres = await Genre.findAll({
      order: [['name', 'ASC']]
    });
    
    // Получаем количество книг в каждом жанре
    const genresWithStats = await Promise.all(
      genres.map(async (genre) => {
        const booksCount = await Book.count({ where: { genre_id: genre.id } });
        return {
          ...genre.toJSON(),
          booksCount
        };
      })
    );
    
    res.render('admin/genres/index', {
      title: 'Управление жанрами',
      layout: 'layouts/admin',
      currentPage: 'genres',
      genres: genresWithStats,
      errors: [],
      user: req.session.user
    });
    
  } catch (error) {
    console.error('Ошибка при загрузке жанров:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/admin');
  }
};

/**
 * 12. ДОБАВЛЕНИЕ ЖАНРА
 */
exports.addGenre = async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name || name.length < 2) {
      req.flash('error', 'Название жанра должно содержать минимум 2 символа');
      return res.redirect('/admin/genres');
    }
    
    // Проверяем, существует ли уже такой жанр
    const existingGenre = await Genre.findOne({ where: { name } });
    
    if (existingGenre) {
      req.flash('error', 'Такой жанр уже существует');
      return res.redirect('/admin/genres');
    }
    
    await Genre.create({ name });
    
    req.flash('success', 'Жанр успешно добавлен');
    res.redirect('/admin/genres');
    
  } catch (error) {
    console.error('Ошибка при добавлении жанра:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/admin/genres');
  }
};

/**
 * 13. РЕДАКТИРОВАНИЕ ЖАНРА
 */
exports.editGenre = async (req, res) => {
  try {
    const genreId = req.params.id;
    const { name } = req.body;
    
    const genre = await Genre.findByPk(genreId);
    
    if (!genre) {
      req.flash('error', 'Жанр не найден');
      return res.redirect('/admin/genres');
    }
    
    if (!name || name.length < 2) {
      req.flash('error', 'Название жанра должно содержать минимум 2 символа');
      return res.redirect('/admin/genres');
    }
    
    // Проверяем, не занято ли имя другим жанром
    const existingGenre = await Genre.findOne({ 
      where: { 
        name,
        id: { [Op.ne]: genreId }
      } 
    });
    
    if (existingGenre) {
      req.flash('error', 'Жанр с таким названием уже существует');
      return res.redirect('/admin/genres');
    }
    
    await genre.update({ name });
    
    req.flash('success', 'Жанр успешно обновлён');
    res.redirect('/admin/genres');
    
  } catch (error) {
    console.error('Ошибка при редактировании жанра:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/admin/genres');
  }
};

/**
 * 14. УДАЛЕНИЕ ЖАНРА
 */
exports.deleteGenre = async (req, res) => {
  try {
    const genreId = req.params.id;
    
    // Проверяем, есть ли книги в этом жанре
    const booksCount = await Book.count({ where: { genre_id: genreId } });
    
    if (booksCount > 0) {
      req.flash('error', 'Нельзя удалить жанр, в котором есть книги');
      return res.redirect('/admin/genres');
    }
    
    const genre = await Genre.findByPk(genreId);
    
    if (!genre) {
      req.flash('error', 'Жанр не найден');
      return res.redirect('/admin/genres');
    }
    
    await genre.destroy();
    
    req.flash('success', 'Жанр успешно удалён');
    res.redirect('/admin/genres');
    
  } catch (error) {
    console.error('Ошибка при удалении жанра:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/admin/genres');
  }
};

/**
 * 15. МОДЕРАЦИЯ РЕЦЕНЗИЙ
 */
exports.getReviews = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;
    const status = req.query.status || 'all'; // all, pending, moderated
    
    const where = {};
    
    if (status === 'pending') {
      where.is_moderated = false;
    } else if (status === 'moderated') {
      where.is_moderated = true;
    }
    
    const { count, rows: reviews } = await Review.findAndCountAll({
      where,
      include: [
        { model: User, as: 'user', attributes: ['id', 'name', 'avatar'] },
        { model: Book, as: 'book', attributes: ['id', 'title', 'author', 'cover_image'] }
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });
    
    res.render('admin/reviews/index', {
      title: 'Модерация рецензий',
      layout: 'layouts/admin',
      currentPage: 'reviews',
      reviews,
      status,
      currentPage: page,
      totalPages: Math.ceil(count / limit),
      totalReviews: count,
      errors: [],
      user: req.session.user
    });
    
  } catch (error) {
    console.error('Ошибка при загрузке рецензий:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/admin');
  }
};

/**
 * 16. ОДОБРЕНИЕ РЕЦЕНЗИИ
 */
exports.approveReview = async (req, res) => {
  try {
    const reviewId = req.params.id;
    
    const review = await Review.findByPk(reviewId);
    
    if (!review) {
      req.flash('error', 'Рецензия не найдена');
      return res.redirect('/admin/reviews');
    }
    
    await review.update({ is_moderated: true });
    
    //  ОТПРАВЛЯЕМ УВЕДОМЛЕНИЕ ОБ ОДОБРЕНИИ
    await notificationService.reviewModerated(review.id, true);

    req.flash('success', 'Рецензия одобрена');
    res.redirect('/admin/reviews');
    
  } catch (error) {
    console.error('Ошибка при одобрении рецензии:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/admin/reviews');
  }
};

/**
 * 17. УДАЛЕНИЕ РЕЦЕНЗИИ (модератором)
 */
exports.deleteReview = async (req, res) => {
  try {
    const reviewId = req.params.id;
    
    const review = await Review.findByPk(reviewId);
    
    if (!review) {
      req.flash('error', 'Рецензия не найдена');
      return res.redirect('/admin/reviews');
    }
    
    await review.destroy();
    
    await notificationService.reviewModerated(review.id, false);

    req.flash('success', 'Рецензия удалена');
    res.redirect('/admin/reviews');
    
  } catch (error) {
    console.error('Ошибка при удалении рецензии:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/admin/reviews');
  }
};

/**
 * 18. СТАТИСТИКА (упрощённая и понятная)
 */
exports.getStatistics = async (req, res) => {
  try {
    // ===== ОСНОВНАЯ СТАТИСТИКА =====
    const totalUsers = await User.count();
    const totalBooks = await Book.count();
    const totalReviews = await Review.count();
    const totalGenres = await Genre.count();
    
    // Статистика за сегодня
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const newUsersToday = await User.count({
      where: { createdAt: { [Op.gte]: today } }
    });
    
    const newBooksToday = await Book.count({
      where: { createdAt: { [Op.gte]: today } }
    });
    
    const newReviewsToday = await Review.count({
      where: { createdAt: { [Op.gte]: today } }
    });
    
    // ===== ТОП ПОПУЛЯРНЫХ КНИГ (по просмотрам) =====
    const topBooks = await Book.findAll({
      attributes: ['id', 'title', 'author', 'cover_image', 'views_count'],
      order: [['views_count', 'DESC']],
      limit: 10
    });
    
    // ===== ТОП КНИГ ПО РЕЙТИНГУ =====
    const topRatedBooks = await sequelize.query(`
      SELECT 
        b.id,
        b.title,
        b.author,
        b.cover_image,
        AVG(r.rating) as avg_rating,
        COUNT(r.id) as reviews_count
      FROM "Books" b
      LEFT JOIN "Reviews" r ON b.id = r.book_id AND r.is_moderated = true
      GROUP BY b.id
      HAVING COUNT(r.id) >= 3
      ORDER BY avg_rating DESC
      LIMIT 10
    `, { type: sequelize.QueryTypes.SELECT });
    
    // ===== ТОП АКТИВНЫХ ПОЛЬЗОВАТЕЛЕЙ =====
    const topUsers = await sequelize.query(`
      SELECT 
        u.id,
        u.name,
        u.avatar,
        COUNT(r.id) as reviews_count
      FROM "Users" u
      LEFT JOIN "Reviews" r ON u.id = r.user_id
      GROUP BY u.id
      ORDER BY reviews_count DESC
      LIMIT 10
    `, { type: sequelize.QueryTypes.SELECT });
    
    // ===== ПОПУЛЯРНЫЕ ЖАНРЫ =====
    const popularGenres = await sequelize.query(`
      SELECT 
        g.id,
        g.name,
        COUNT(b.id) as books_count
      FROM "Genres" g
      LEFT JOIN "Books" b ON g.id = b.genre_id
      GROUP BY g.id
      ORDER BY books_count DESC
      LIMIT 5
    `, { type: sequelize.QueryTypes.SELECT });
    
    res.render('admin/statistics', {
      title: 'Статистика',
      layout: 'layouts/admin',
      currentPage: 'statistics',
      stats: {
        totalUsers,
        totalBooks,
        totalReviews,
        totalGenres,
        newUsersToday,
        newBooksToday,
        newReviewsToday
      },
      topBooks,
      topRatedBooks,
      topUsers,
      popularGenres,
      user: req.session.user
    });
    
  } catch (error) {
    console.error('Ошибка при загрузке статистики:', error);
    req.flash('error', 'Произошла ошибка при загрузке статистики');
    res.redirect('/admin');
  }
};
