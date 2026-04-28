const { User, Book, Review, UserBook, Genre, ReviewLike } = require('../models');
const { Op } = require('sequelize');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs').promises;
const sharp = require('sharp');

const SALT_ROUNDS = 10;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

exports.getProfile = async (req, res) => {
  try {
    const userId = req.session.user.id;
    
    const user = await User.findByPk(userId, {
      attributes: { exclude: ['password_hash'] }
    });
    
    const stats = {
      booksRead: await UserBook.count({ where: { user_id: userId, status: 'read' } }),
      booksWantToRead: await UserBook.count({ where: { user_id: userId, status: 'want_to_read' } }),
      booksReading: await UserBook.count({ where: { user_id: userId, status: 'reading' } }),
      reviewsCount: await Review.count({ where: { user_id: userId } })
    };
    
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

exports.postEditProfile = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { name, bio } = req.body;
    
    
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
      const updatedUser = await User.findByPk(userId, {
        attributes: { exclude: ['password_hash'] }
      });
      
      req.session.user = {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        avatar: updatedUser.avatar
      };
      
    }
    
    req.flash('success', 'Профиль успешно обновлён');
    res.redirect('/profile');
    
  } catch (error) {
    console.error('Ошибка при обновлении профиля:', error);
    req.flash('error', 'Произошла ошибка при обновлении профиля');
    res.redirect('/profile/edit');
  }
};

exports.uploadAvatar = async (req, res) => {
  try {
    const userId = req.session.user.id;
    
    if (!req.file) {
      req.flash('error', 'Пожалуйста, выберите файл');
      return res.redirect('/profile/edit');
    }
    
    const user = await User.findByPk(userId);
    
    if (user.avatar && user.avatar !== 'default-avatar.png') {
      const oldAvatarPath = path.join(__dirname, '../public/images/avatars', user.avatar);
      try {
        await fs.unlink(oldAvatarPath);
      } catch (err) {
        console.log('Не удалось удалить старую аватарку:', err.message);
      }
    }
    
    const avatarPath = path.join(__dirname, '../public/images/avatars', req.file.filename);
    await sharp(avatarPath)
      .resize(400, 400, {
        fit: 'cover',
        position: 'centre'
      })
      .toFile(`${avatarPath}.tmp`);
    await fs.rename(`${avatarPath}.tmp`, avatarPath);

    await User.update(
      { avatar: req.file.filename },
      { where: { id: userId } }
    );
    
    req.session.user.avatar = req.file.filename;
    
    req.flash('success', 'Аватарка успешно обновлена');
    res.redirect('/profile/edit');
    
  } catch (error) {
    console.error('Ошибка при загрузке аватарки:', error);
    req.flash('error', 'Произошла ошибка при загрузке аватарки');
    res.redirect('/profile/edit');
  }
};

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
    
    const user = await User.findByPk(userId);
    
    const isMatch = await bcrypt.compare(current_password, user.password_hash);
    
    if (!isMatch) {
      errors.push({ msg: 'Неверный текущий пароль' });
      return res.render('profile/edit', {
        title: 'Редактирование профиля',
        user,
        errors
      });
    }
    
    const hashedPassword = await bcrypt.hash(new_password, SALT_ROUNDS);
    
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

exports.getMyBooks = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const status = req.query.status || 'all'; // all, read, want_to_read, reading
    
    const page = parseInt(req.query.page) || 1;
    const limit = 12;
    const offset = (page - 1) * limit;
    
    const where = { user_id: userId };
    if (status !== 'all') {
      where.status = status;
    }
    
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

exports.updateBookStatus = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { book_id, status } = req.body;
    
    const book = await Book.findByPk(book_id);
    if (!book) {
      return res.status(404).json({ error: 'Книга не найдена' });
    }
    
    const userBook = await UserBook.findOne({
      where: { user_id: userId, book_id }
    });
    
    if (userBook) {
      await userBook.update({ status });
    } else {
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

exports.postEditReview = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const reviewId = req.params.reviewId;
    const { rating, content } = req.body;
    
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

exports.getPublicProfile = async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    const currentUserId = req.session.user ? req.session.user.id : null;

    if (currentUserId && currentUserId === userId) {
      return res.redirect('/profile');
    }
    
    const user = await User.findByPk(userId, {
      attributes: ['id', 'name', 'avatar', 'bio', 'createdAt', 'role']
    });
    
    if (!user) {
      req.flash('error', 'Пользователь не найден');
      return res.redirect('/');
    }
    
    const [booksRead, booksWantToRead, booksReading, reviewsCount] = await Promise.all([
      UserBook.count({ where: { user_id: userId, status: 'read' } }),
      UserBook.count({ where: { user_id: userId, status: 'want_to_read' } }),
      UserBook.count({ where: { user_id: userId, status: 'reading' } }),
      Review.count({ where: { user_id: userId } })
    ]);

    const stats = { booksRead, booksWantToRead, booksReading, reviewsCount };
    
    const recentReviews = await Review.findAll({
      where: { user_id: userId },
      include: [{ model: Book, as: 'book', attributes: ['id', 'title', 'author', 'cover_image'] }],
      order: [['createdAt', 'DESC']],
      limit: 10
    });

    const recentBooks = await UserBook.findAll({
      where: { user_id: userId },
      include: [{
        model: Book,
        as: 'book',
        include: [{ model: Genre, as: 'genre' }]
      }],
      order: [['updatedAt', 'DESC']],
      limit: 12
    });
    
    res.render('profile/public', {
      title: `Профиль ${user.name}`,
      profileUser: user,
      stats,
      recentReviews,
      recentBooks
    });
    
  } catch (error) {
    console.error('Ошибка при загрузке публичного профиля:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/');
  }
};
