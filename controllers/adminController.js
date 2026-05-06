const { User, Book, Genre, Review, UserBook, ForumPost, sequelize } = require('../models');
const { Op } = require('sequelize');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs').promises;
const sharp = require('sharp');
const notificationService = require('../services/notificationService');
const uploadService = require('../services/uploadService');

const SALT_ROUNDS = 10;
const ADMIN_POLICY = {
  maxAdmins: 5,
  minAccountAgeDays: 30,
  minReviews: 5,
  minActivityScore: 30,
  reviewWeight: 3,
  bookWeight: 1,
  forumPostWeight: 1
};

function getAccountAgeDays(createdAt) {
  const created = new Date(createdAt);

  if (Number.isNaN(created.getTime())) {
    return 0;
  }

  return Math.max(0, Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24)));
}

function getActivityScore({ reviewsCount = 0, booksCount = 0, forumPostsCount = 0 }) {
  return (reviewsCount * ADMIN_POLICY.reviewWeight)
    + (booksCount * ADMIN_POLICY.bookWeight)
    + (forumPostsCount * ADMIN_POLICY.forumPostWeight);
}

function getAdminEligibility(user, stats, currentAdminCount) {
  const accountAgeDays = getAccountAgeDays(user.createdAt);
  const activityScore = getActivityScore(stats);
  const checks = [
    {
      passed: !user.isBlocked,
      message: 'аккаунт не заблокирован'
    },
    {
      passed: accountAgeDays >= ADMIN_POLICY.minAccountAgeDays,
      message: `на сайте не менее ${ADMIN_POLICY.minAccountAgeDays} дней`
    },
    {
      passed: stats.reviewsCount >= ADMIN_POLICY.minReviews,
      message: `минимум ${ADMIN_POLICY.minReviews} рецензий`
    },
    {
      passed: activityScore >= ADMIN_POLICY.minActivityScore,
      message: `индекс активности от ${ADMIN_POLICY.minActivityScore}`
    }
  ];

  const hasFreeAdminSlot = user.role === 'admin' || currentAdminCount < ADMIN_POLICY.maxAdmins;
  const missingReasons = checks.filter((check) => !check.passed).map((check) => check.message);

  if (!hasFreeAdminSlot) {
    missingReasons.push(`лимит ${ADMIN_POLICY.maxAdmins} администраторов уже достигнут`);
  }

  return {
    canBeAdmin: missingReasons.length === 0,
    accountAgeDays,
    activityScore,
    missingReasons,
    summary: missingReasons.length > 0
      ? missingReasons.join('; ')
      : 'подходит: давно в сообществе и активно участвует'
  };
}

function wantsJson(req) {
  return req.xhr || req.is('application/json') || (req.get('accept') || '').includes('application/json');
}

function sendRoleError(req, res, message, status = 400) {
  if (wantsJson(req)) {
    return res.status(status).json({ error: message });
  }

  req.flash('error', message);
  return res.redirect('/admin/users');
}

function sendRoleSuccess(req, res, message) {
  if (wantsJson(req)) {
    return res.json({ success: true, message });
  }

  req.flash('success', message);
  return res.redirect('/admin/users');
}

// Функция для получения публичного URL обложки
function getCoverUrl(coverImage, coverPublicId) {
  // Если есть URL из облака — возвращаем его
  if (coverImage && coverImage.startsWith('http')) {
    return coverImage;
  }
  // Дефолтная обложка
  if (!coverImage || coverImage === 'default-book-cover.jpg') {
    return '/images/covers/default-book-cover.jpg';
  }
  // Старый локальный файл (для обратной совместимости)
  return `/images/covers/${coverImage}`;
}

exports.getDashboard = async (req, res) => {
  if (req.session.user.role === 'moderator') {
    return res.redirect('/admin/reviews?status=pending');
  }

  try {
    const stats = {
      totalUsers: await User.count(),
      totalBooks: await Book.count(),
      totalReviews: await Review.count(),
      totalGenres: await Genre.count(),
      
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
    
    const rolesStatsRaw = await User.findAll({
      attributes: [
        'role',
        [sequelize.fn('COUNT', sequelize.col('role')), 'count']
      ],
      group: ['role']
    });
    
    const rolesStats = rolesStatsRaw.map(stat => ({
      role: stat.role,
      count: parseInt(stat.dataValues.count)
    }));
    
    const formattedRolesStats = rolesStats.length > 0 ? rolesStats : [];
    
    const recentUsers = await User.findAll({
      attributes: ['id', 'name', 'email', 'role', 'avatar', 'createdAt'],
      order: [['createdAt', 'DESC']],
      limit: 5
    });
    
    const recentBooks = await Book.findAll({
      include: [{ model: Genre, as: 'genre', attributes: ['name'] }],
      order: [['createdAt', 'DESC']],
      limit: 5
    });
    
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

exports.getBooks = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    
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
    
    const booksWithStats = await Promise.all(
      books.map(async (book) => {
        const reviewsCount = await Review.count({ where: { book_id: book.id } });
        const avgRating = await book.getAverageRating();
        const inUserBooks = await UserBook.count({ where: { book_id: book.id } });
        
        return {
          ...book.toJSON(),
          reviewsCount,
          avgRating,
          inUserBooks,
          coverUrl: getCoverUrl(book.cover_image, book.cover_public_id)
        };
      })
    );
    
    res.render('admin/books/index', {
      title: 'Управление книгами',
      layout: 'layouts/admin',
      currentPage: 'books',
      books: booksWithStats,
      search,
      currentPageNum: page,
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

exports.postAddBook = async (req, res) => {
  try {
    const {
      title, author, description, year, pages,
      publisher, genre_id, isbn
    } = req.body;
    
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
    
    let coverUrl = '/images/covers/default-book-cover.jpg';
    let coverPublicId = null;
    
    if (req.file) {
      // Обрабатываем изображение: ресайз и конвертация
      const processedBuffer = await sharp(req.file.buffer)
        .resize(300, 450, { fit: 'cover' })
        .jpeg({ quality: 85 })
        .toBuffer();
      
      // Загружаем в облако (bookId пока null, будет после создания)
      const result = await uploadService.uploadBookCover(processedBuffer, null);
      coverUrl = result.url;
      coverPublicId = result.publicId;
    }
    
    const newBook = await Book.create({
      title,
      author,
      description,
      year: year || null,
      pages: pages || null,
      publisher: publisher || null,
      genre_id: genre_id || null,
      cover_image: coverUrl,
      cover_public_id: coverPublicId,
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
      book: {
        ...book.toJSON(),
        coverUrl: getCoverUrl(book.cover_image, book.cover_public_id)
      },
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

exports.postEditBook = async (req, res) => {
  try {
    const bookId = req.params.id;
    const {
      title, author, description, year, pages,
      publisher, genre_id, isbn
    } = req.body;
    
    const book = await Book.findByPk(bookId);
    
    if (!book) {
      req.flash('error', 'Книга не найдена');
      return res.redirect('/admin/books');
    }
    
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
        layout: 'layouts/admin',
        currentPage: 'books',
        book: { ...book.toJSON(), ...req.body },
        genres,
        errors,
        user: req.session.user
      });
    }
    
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
    
    // Обновление обложки
    if (req.file) {
      // Удаляем старый файл из облака (если не дефолтный)
      if (book.cover_public_id && !book.cover_public_id.includes('default')) {
        await uploadService.deleteImage(book.cover_public_id);
      }
      
      // Обрабатываем новое изображение
      const processedBuffer = await sharp(req.file.buffer)
        .resize(300, 450, { fit: 'cover' })
        .jpeg({ quality: 85 })
        .toBuffer();
      
      const result = await uploadService.uploadBookCover(processedBuffer, bookId);
      updateData.cover_image = result.url;
      updateData.cover_public_id = result.publicId;
    }
    
    await book.update(updateData);
    
    req.flash('success', 'Книга успешно обновлена');
    res.redirect('/admin/books');
    
  } catch (error) {
    console.error('❌ Ошибка при обновлении книги:', error);
    req.flash('error', 'Произошла ошибка при обновлении книги');
    res.redirect(`/admin/books/${req.params.id}/edit`);
  }
};

exports.deleteBook = async (req, res) => {
  try {
    const bookId = req.params.id;
    
    const book = await Book.findByPk(bookId);
    
    if (!book) {
      req.flash('error', 'Книга не найдена');
      return res.redirect('/admin/books');
    }
    
    // Удаляем обложку из облака (если не дефолтная)
    if (book.cover_public_id && !book.cover_public_id.includes('default')) {
      await uploadService.deleteImage(book.cover_public_id);
    }
    
    await Review.destroy({ where: { book_id: bookId } });
    await UserBook.destroy({ where: { book_id: bookId } });
    
    await book.destroy();
    
    req.flash('success', 'Книга успешно удалена');
    res.redirect('/admin/books');
    
  } catch (error) {
    console.error('Ошибка при удалении книги:', error);
    req.flash('error', 'Произошла ошибка при удалении книги');
    res.redirect('/admin/books');
  }
};

exports.getUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const role = req.query.role || 'all';
    
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
    
    const currentAdminCount = await User.count({ where: { role: 'admin' } });

    const usersWithStats = await Promise.all(
      users.map(async (user) => {
        const booksCount = await UserBook.count({ where: { user_id: user.id } });
        const reviewsCount = await Review.count({ where: { user_id: user.id } });
        const forumPostsCount = await ForumPost.count({ where: { user_id: user.id } });
        const stats = { booksCount, reviewsCount, forumPostsCount };

        return {
          ...user.toJSON(),
          ...stats,
          adminEligibility: getAdminEligibility(user, stats, currentAdminCount)
        };
      })
    );
    
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
      adminPolicy: ADMIN_POLICY,
      currentAdminCount,
      search,
      currentRole: role,
      currentPageNum: page,
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

exports.updateUserRole = async (req, res) => {
  try {
    const userId = req.params.id;
    const { role } = req.body;

    const allowedRoles = ['user', 'moderator', 'admin'];
    if (!allowedRoles.includes(role)) {
      return sendRoleError(req, res, 'Недопустимая роль');
    }

    if (userId == req.session.user.id && role !== 'admin') {
      return sendRoleError(req, res, 'Вы не можете понизить свою роль');
    }

    const user = await User.findByPk(userId);

    if (!user) {
      return sendRoleError(req, res, 'Пользователь не найден', 404);
    }

    if (role === 'admin' && user.role !== 'admin') {
      const currentAdminCount = await User.count({ where: { role: 'admin' } });

      if (currentAdminCount >= ADMIN_POLICY.maxAdmins) {
        return sendRoleError(
          req,
          res,
          `Нельзя назначить администратора: лимит ${ADMIN_POLICY.maxAdmins} администраторов уже достигнут`
        );
      }

      const stats = {
        booksCount: await UserBook.count({ where: { user_id: user.id } }),
        reviewsCount: await Review.count({ where: { user_id: user.id } }),
        forumPostsCount: await ForumPost.count({ where: { user_id: user.id } })
      };
      const eligibility = getAdminEligibility(user, stats, currentAdminCount);

      if (!eligibility.canBeAdmin) {
        return sendRoleError(
          req,
          res,
          `Нельзя назначить администратора: ${eligibility.summary}. Администратор должен быть проверенным активным участником сообщества.`
        );
      }
    }

    await user.update({ role });

    const roleLabels = {
      user: 'пользователь',
      moderator: 'модератор',
      admin: 'администратор'
    };
    return sendRoleSuccess(req, res, `Роль пользователя ${user.name} изменена на «${roleLabels[role]}»`);

  } catch (error) {
    console.error('Ошибка при изменении роли:', error);
    return sendRoleError(req, res, 'Произошла ошибка');
  }
};

exports.toggleUserBlock = async (req, res) => {
  try {
    const userId = req.params.id;
    
    if (userId == req.session.user.id) {
      req.flash('error', 'Вы не можете заблокировать самого себя');
      return res.redirect('/admin/users');
    }
    
    const user = await User.findByPk(userId);
    
    if (!user) {
      req.flash('error', 'Пользователь не найдена');
      return res.redirect('/admin/users');
    }
    
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

exports.getGenres = async (req, res) => {
  try {
    const genres = await Genre.findAll({
      order: [['name', 'ASC']]
    });
    
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

exports.addGenre = async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name || name.length < 2) {
      req.flash('error', 'Название жанра должно содержать минимум 2 символа');
      return res.redirect('/admin/genres');
    }
    
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

exports.deleteGenre = async (req, res) => {
  try {
    const genreId = req.params.id;
    
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

exports.getReviews = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;
    const status = req.query.status || 'all';
    
    const where = {};
    
    if (status === 'pending') {
      where.is_moderated = false;
    } else if (status === 'moderated') {
      where.is_moderated = true;
    }
    
    const { count, rows: reviews } = await Review.findAndCountAll({
      where,
      include: [
        { model: User, as: 'user', attributes: ['id', 'name', 'avatar', 'avatar_public_id'] },
        { model: Book, as: 'book', attributes: ['id', 'title', 'author', 'cover_image', 'cover_public_id'] }
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
      currentPageNum: page,
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

exports.approveReview = async (req, res) => {
  try {
    const reviewId = req.params.id;
    
    const review = await Review.findByPk(reviewId);
    
    if (!review) {
      req.flash('error', 'Рецензия не найдена');
      return res.redirect('/admin/reviews');
    }
    
    await review.update({ is_moderated: true });
    
    await notificationService.reviewModerated(review.id, true);

    req.flash('success', 'Рецензия одобрена');
    res.redirect('/admin/reviews');
    
  } catch (error) {
    console.error('Ошибка при одобрении рецензии:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/admin/reviews');
  }
};

exports.deleteReview = async (req, res) => {
  try {
    const reviewId = req.params.id;
    
    const review = await Review.findByPk(reviewId);
    
    if (!review) {
      req.flash('error', 'Рецензия не найдена');
      return res.redirect('/admin/reviews');
    }
    
    await notificationService.reviewModerated(review.id, false);

    await review.destroy();

    req.flash('success', 'Рецензия отклонена');
    res.redirect('/admin/reviews');
    
  } catch (error) {
    console.error('Ошибка при удалении рецензии:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/admin/reviews');
  }
};

exports.getStatistics = async (req, res) => {
  try {
    const totalUsers = await User.count();
    const totalBooks = await Book.count();
    const totalReviews = await Review.count();
    const totalGenres = await Genre.count();
    
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
    
    const topBooks = await Book.findAll({
      attributes: ['id', 'title', 'author', 'cover_image', 'views_count'],
      order: [['views_count', 'DESC']],
      limit: 10
    });
    
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
    
    // Добавляем URL обложек для topBooks
    const topBooksWithUrls = topBooks.map(book => ({
      ...book.toJSON(),
      coverUrl: getCoverUrl(book.cover_image, book.cover_public_id)
    }));
    
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
      topBooks: topBooksWithUrls,
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