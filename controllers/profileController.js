const { User, Book, Review, UserBook, Genre, ReviewLike } = require('../models');
const { Op } = require('sequelize');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs').promises;
const sharp = require('sharp');

// Константы
const SALT_ROUNDS = 10;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * 1. ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ (главная страница профиля)
 */
exports.getProfile = async (req, res) => {
  try {
    const userId = req.session.user.id;
    
    // Получаем полную информацию о пользователе
    const user = await User.findByPk(userId, {
      attributes: { exclude: ['password_hash'] }
    });
    
    // Получаем статистику пользователя
    const stats = {
      booksRead: await UserBook.count({ where: { user_id: userId, status: 'read' } }),
      booksWantToRead: await UserBook.count({ where: { user_id: userId, status: 'want_to_read' } }),
      booksReading: await UserBook.count({ where: { user_id: userId, status: 'reading' } }),
      reviewsCount: await Review.count({ where: { user_id: userId } })
    };
    
    // Получаем последние действия пользователя
    const recentReviews = await Review.findAll({
      where: { user_id: userId },
      include: [{ model: Book, as: 'book', attributes: ['id', 'title', 'author', 'cover_image'] }],
      order: [['createdAt', 'DESC']],
      limit: 5
    });
    
    const recentBooks = await UserBook.findAll({
      where: { user_id: userId },
      include: [{ 
        model: Book, 
        as: 'book', 
        include: [{ model: Genre, as: 'genre' }] 
      }],
      order: [['updatedAt', 'DESC']],
      limit: 5
    });
    
    res.render('profile/index', {
      title: 'Мой профиль',
      user,
      stats,
      recentReviews,
      recentBooks
    });
    
  } catch (error) {
    console.error('Ошибка при загрузке профиля:', error);
    req.flash('error', 'Произошла ошибка при загрузке профиля');
    res.redirect('/');
  }
};


/**
 * 2. РЕДАКТИРОВАНИЕ ПРОФИЛЯ (форма)
 */
exports.getEditProfile = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const user = await User.findByPk(userId, {
      attributes: { exclude: ['password_hash'] }
    });
    
    res.render('profile/edit', {
      title: 'Редактирование профиля',
      user,
      errors: [] // добавляем пустой массив ошибок
    });
    
  } catch (error) {
    console.error('Ошибка при загрузке формы редактирования:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/profile');
  }
};

/**
 * 3. ОБНОВЛЕНИЕ ПРОФИЛЯ (ИСПРАВЛЕННАЯ ВЕРСИЯ)
 */
exports.postEditProfile = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { name, bio } = req.body;
    
    console.log('Получены данные:', { name, bio }); // для отладки
    
    // Валидация
    const errors = [];
    
    if (!name || name.length < 2) {
      errors.push({ msg: 'Имя должно содержать минимум 2 символа' });
    }
    
    if (bio && bio.length > 500) {
      errors.push({ msg: 'Биография не может быть длиннее 500 символов' });
    }
    
    if (errors.length > 0) {
      const user = await User.findByPk(userId, {
        attributes: { exclude: ['password_hash'] }
      });
      return res.render('profile/edit', {
        title: 'Редактирование профиля',
        user,
        errors,
        name,
        bio
      });
    }
    
    // Обновляем пользователя
    const [updated] = await User.update(
      { 
        name: name.trim(),
        bio: bio ? bio.trim() : '' 
      },
      { 
        where: { id: userId },
        returning: true // для PostgreSQL возвращает обновлённую запись
      }
    );
    
    if (updated) {
      // Получаем обновлённого пользователя
      const updatedUser = await User.findByPk(userId, {
        attributes: { exclude: ['password_hash'] }
      });
      
      // Обновляем данные в сессии
      req.session.user = {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        avatar: updatedUser.avatar
      };
      
      console.log('Профиль обновлён:', updatedUser.toJSON()); // для отладки
    }
    
    req.flash('success', 'Профиль успешно обновлён');
    res.redirect('/profile');
    
  } catch (error) {
    console.error('Ошибка при обновлении профиля:', error);
    req.flash('error', 'Произошла ошибка при обновлении профиля');
    res.redirect('/profile/edit');
  }
};

/**
 * 4. ЗАГРУЗКА АВАТАРКИ
 */
exports.uploadAvatar = async (req, res) => {
  try {
    const userId = req.session.user.id;
    
    if (!req.file) {
      req.flash('error', 'Пожалуйста, выберите файл');
      return res.redirect('/profile/edit');
    }
    
    // Получаем старого пользователя для удаления старой аватарки
    const user = await User.findByPk(userId);
    
    // Если у пользователя была не стандартная аватарка, удаляем старый файл
    if (user.avatar && user.avatar !== 'default-avatar.png') {
      const oldAvatarPath = path.join(__dirname, '../public/images/avatars', user.avatar);
      try {
        await fs.unlink(oldAvatarPath);
      } catch (err) {
        console.log('Не удалось удалить старую аватарку:', err.message);
      }
    }
    
    // Нормализуем аватар до квадратного формата (чтобы красиво отображался везде)
    const avatarPath = path.join(__dirname, '../public/images/avatars', req.file.filename);
    await sharp(avatarPath)
      .resize(400, 400, {
        fit: 'cover',
        position: 'centre'
      })
      .toFile(`${avatarPath}.tmp`);
    await fs.rename(`${avatarPath}.tmp`, avatarPath);

    // Обновляем запись в БД
    await User.update(
      { avatar: req.file.filename },
      { where: { id: userId } }
    );
    
    // Обновляем сессию
    req.session.user.avatar = req.file.filename;
    
    req.flash('success', 'Аватарка успешно обновлена');
    res.redirect('/profile/edit');
    
  } catch (error) {
    console.error('Ошибка при загрузке аватарки:', error);
    req.flash('error', 'Произошла ошибка при загрузке аватарки');
    res.redirect('/profile/edit');
  }
};

/**
 * 5. СМЕНА ПАРОЛЯ
 */
exports.postChangePassword = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { current_password, new_password, confirm_password } = req.body;
    
    const errors = [];
    
    if (!current_password || !new_password || !confirm_password) {
      errors.push({ msg: 'Пожалуйста, заполните все поля' });
    }
    
    if (new_password && new_password.length < 6) {
      errors.push({ msg: 'Новый пароль должен содержать минимум 6 символов' });
    }
    
    if (new_password !== confirm_password) {
      errors.push({ msg: 'Пароли не совпадают' });
    }
    
    if (errors.length > 0) {
      const user = await User.findByPk(userId);
      return res.render('profile/edit', {
        title: 'Редактирование профиля',
        user,
        errors
      });
    }
    
    // Получаем пользователя с паролем
    const user = await User.findByPk(userId);
    
    // Проверяем текущий пароль
    const isMatch = await bcrypt.compare(current_password, user.password_hash);
    
    if (!isMatch) {
      errors.push({ msg: 'Неверный текущий пароль' });
      return res.render('profile/edit', {
        title: 'Редактирование профиля',
        user,
        errors
      });
    }
    
    // Хешируем новый пароль
    const hashedPassword = await bcrypt.hash(new_password, SALT_ROUNDS);
    
    // Обновляем пароль
    await User.update(
      { password_hash: hashedPassword },
      { where: { id: userId } }
    );
    
    req.flash('success', 'Пароль успешно изменён');
    res.redirect('/profile/edit');
    
  } catch (error) {
    console.error('Ошибка при смене пароля:', error);
    req.flash('error', 'Произошла ошибка при смене пароля');
    res.redirect('/profile/edit');
  }
};

/**
 * 6. МОИ КНИГИ (полки)
 */
exports.getMyBooks = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const status = req.query.status || 'all'; // all, read, want_to_read, reading
    
    // Настройки пагинации
    const page = parseInt(req.query.page) || 1;
    const limit = 12;
    const offset = (page - 1) * limit;
    
    // Базовый where для запроса
    const where = { user_id: userId };
    if (status !== 'all') {
      where.status = status;
    }
    
    // Получаем книги пользователя с пагинацией
    const { count, rows: userBooks } = await UserBook.findAndCountAll({
      where,
      include: [
        {
          model: Book,
          as: 'book',
          include: [{ model: Genre, as: 'genre' }]
        }
      ],
      order: [['updatedAt', 'DESC']],
      limit,
      offset
    });
    
    // Получаем статистику по каждой книге
    const booksWithDetails = await Promise.all(
      userBooks.map(async (ub) => {
        const book = ub.book;
        const averageRating = await book.getAverageRating();
        const userReview = await Review.findOne({
          where: { user_id: userId, book_id: book.id }
        });
        
        return {
          ...ub.toJSON(),
          book: {
            ...book.toJSON(),
            averageRating,
            userReview: userReview ? {
              id: userReview.id,
              rating: userReview.rating,
              content: userReview.content
            } : null
          }
        };
      })
    );
    
    // Считаем количество книг по статусам
    const counts = {
      all: await UserBook.count({ where: { user_id: userId } }),
      read: await UserBook.count({ where: { user_id: userId, status: 'read' } }),
      want_to_read: await UserBook.count({ where: { user_id: userId, status: 'want_to_read' } }),
      reading: await UserBook.count({ where: { user_id: userId, status: 'reading' } })
    };
    
    res.render('profile/books', {
      title: 'Мои книги',
      books: booksWithDetails,
      counts,
      currentStatus: status,
      currentPage: page,
      totalPages: Math.ceil(count / limit),
      totalBooks: count
    });
    
  } catch (error) {
    console.error('Ошибка при загрузке моих книг:', error);
    req.flash('error', 'Произошла ошибка при загрузке книг');
    res.redirect('/profile');
  }
};

/**
 * 7. ИЗМЕНЕНИЕ СТАТУСА КНИГИ (AJAX)
 */
exports.updateBookStatus = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { book_id, status } = req.body;
    
    // Проверяем существование книги
    const book = await Book.findByPk(book_id);
    if (!book) {
      return res.status(404).json({ error: 'Книга не найдена' });
    }
    
    // Ищем существующую запись
    const userBook = await UserBook.findOne({
      where: { user_id: userId, book_id }
    });
    
    if (userBook) {
      // Обновляем статус
      await userBook.update({ status });
    } else {
      // Создаём новую запись
      await UserBook.create({
        user_id: userId,
        book_id,
        status
      });
    }
    
    res.json({ success: true, status });
    
  } catch (error) {
    console.error('Ошибка при обновлении статуса книги:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
};

/**
 * 8. УДАЛЕНИЕ КНИГИ С ПОЛКИ
 */
exports.removeBookFromShelf = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const bookId = req.params.bookId;
    
    await UserBook.destroy({
      where: { user_id: userId, book_id: bookId }
    });
    
    req.flash('success', 'Книга удалена с полки');
    res.redirect('/profile/books');
    
  } catch (error) {
    console.error('Ошибка при удалении книги:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/profile/books');
  }
};

/**
 * 9. МОИ РЕЦЕНЗИИ
 */
exports.getMyReviews = async (req, res) => {
  try {
    const userId = req.session.user.id;
    
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;
    
    const { count, rows: reviews } = await Review.findAndCountAll({
      where: { user_id: userId },
      include: [
        {
          model: Book,
          as: 'book',
          attributes: ['id', 'title', 'author', 'cover_image']
        }
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });
    
    // Добавляем информацию о полезности
    const reviewsWithStats = reviews.map(review => ({
      ...review.toJSON(),
      helpful_percent: review.likes_count + review.dislikes_count > 0
        ? Math.round((review.likes_count / (review.likes_count + review.dislikes_count)) * 100)
        : 0
    }));
    
    res.render('profile/reviews', {
      title: 'Мои рецензии',
      reviews: reviewsWithStats,
      currentPage: page,
      totalPages: Math.ceil(count / limit),
      totalReviews: count
    });
    
  } catch (error) {
    console.error('Ошибка при загрузке рецензий:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/profile');
  }
};

/**
 * 10. РЕДАКТИРОВАНИЕ РЕЦЕНЗИИ (форма)
 */
exports.getEditReview = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const reviewId = req.params.reviewId;
    
    const review = await Review.findOne({
      where: { id: reviewId, user_id: userId },
      include: [{ model: Book, as: 'book' }]
    });
    
    if (!review) {
      req.flash('error', 'Рецензия не найдена');
      return res.redirect('/profile/reviews');
    }
    
    res.render('profile/edit-review', {
      title: 'Редактирование рецензии',
      review
    });
    
  } catch (error) {
    console.error('Ошибка при загрузке рецензии:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/profile/reviews');
  }
};

/**
 * 11. ОБНОВЛЕНИЕ РЕЦЕНЗИИ
 */
exports.postEditReview = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const reviewId = req.params.reviewId;
    const { rating, content } = req.body;
    
    // Валидация
    const errors = [];
    
    if (!rating || rating < 1 || rating > 5) {
      errors.push({ msg: 'Оценка должна быть от 1 до 5' });
    }
    
    if (!content || content.length < 10) {
      errors.push({ msg: 'Рецензия должна содержать минимум 10 символов' });
    }
    
    if (errors.length > 0) {
      const review = await Review.findByPk(reviewId, {
        include: [{ model: Book, as: 'book' }]
      });
      return res.render('profile/edit-review', {
        title: 'Редактирование рецензии',
        review,
        errors,
        rating,
        content
      });
    }
    
    // Обновляем рецензию
    await Review.update(
      { rating, content },
      { where: { id: reviewId, user_id: userId } }
    );
    
    req.flash('success', 'Рецензия успешно обновлена');
    res.redirect('/profile/reviews');
    
  } catch (error) {
    console.error('Ошибка при обновлении рецензии:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect(`/profile/reviews/${req.params.reviewId}/edit`);
  }
};

/**
 * 12. УДАЛЕНИЕ РЕЦЕНЗИИ
 */
exports.deleteReview = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const reviewId = req.params.reviewId;
    
    await Review.destroy({
      where: { id: reviewId, user_id: userId }
    });
    
    req.flash('success', 'Рецензия удалена');
    res.redirect('/profile/reviews');
    
  } catch (error) {
    console.error('Ошибка при удалении рецензии:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/profile/reviews');
  }
};

/**
 * 13. ПУБЛИЧНЫЙ ПРОФИЛЬ (просмотр профиля другого пользователя)
 */
exports.getPublicProfile = async (req, res) => {
  try {
    const userId = Number(req.params.userId);

    // Если пользователь открыл ссылку на самого себя - отправляем в личный профиль
    if (req.session.user && req.session.user.id === userId) {
      return res.redirect('/profile');
    }
    
    // Получаем информацию о пользователе
    const user = await User.findByPk(userId, {
      attributes: ['id', 'name', 'avatar', 'bio', 'createdAt', 'role']
    });
    
    if (!user) {
      req.flash('error', 'Пользователь не найден');
      return res.redirect('/');
    }
    
    // Получаем публичную статистику
    const stats = {
      booksRead: await UserBook.count({ where: { user_id: userId, status: 'read' } }),
      booksWantToRead: await UserBook.count({ where: { user_id: userId, status: 'want_to_read' } }),
      booksReading: await UserBook.count({ where: { user_id: userId, status: 'reading' } }),
      reviewsCount: await Review.count({ where: { user_id: userId, is_moderated: true } })
    };
    
    // Получаем последние рецензии пользователя
    const recentReviews = await Review.findAll({
      where: { user_id: userId, is_moderated: true },
      include: [{ model: Book, as: 'book', attributes: ['id', 'title', 'author', 'cover_image'] }],
      order: [['createdAt', 'DESC']],
      limit: 20
    });

    // Получаем книги пользователя на полках
    const userBooks = await UserBook.findAll({
      where: { user_id: userId },
      include: [{
        model: Book,
        as: 'book',
        include: [{ model: Genre, as: 'genre' }]
      }],
      order: [['updatedAt', 'DESC']],
      limit: 60
    });
    
    res.render('profile/public', {
      title: `Профиль ${user.name}`,
      profileUser: user,
      stats,
      recentReviews,
      userBooks
    });
    
  } catch (error) {
    console.error('Ошибка при загрузке публичного профиля:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/');
  }
};
