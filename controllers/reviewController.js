const { Review, Book, User, UserBook, ReviewLike } = require('../models');
const { Op } = require('sequelize');
const notificationService = require('../services/notificationService');

async function updateBookRating(bookId) {
  try {
    const book = await Book.findByPk(bookId);
    if (!book) return;
    
    const reviews = await Review.findAll({
      where: {
        book_id: bookId,
        is_moderated: true
      },
      attributes: ['rating']
    });
    
    const ratingsCount = reviews.length;
    
    if (ratingsCount === 0) {
      await book.update({
        ratings_count: 0
      });
      return;
    }
    
    await book.update({
      ratings_count: ratingsCount
    });
    
  } catch (error) {
    console.error(`❌ Ошибка при обновлении рейтинга книги ${bookId}:`, error);
  }
}

exports.getNewReview = async (req, res) => {
  try {
    const bookId = req.params.bookId;
    
    const book = await Book.findByPk(bookId);
    
    if (!book) {
      req.flash('error', 'Книга не найдена');
      return res.redirect('/books');
    }
    
    const existingReview = await Review.findOne({
      where: {
        user_id: req.session.user.id,
        book_id: bookId
      }
    });
    
    if (existingReview) {
      req.flash('error', 'Вы уже написали рецензию на эту книгу');
      return res.redirect(`/books/${bookId}`);
    }
    
    const userBook = await UserBook.findOne({
      where: {
        user_id: req.session.user.id,
        book_id: bookId,
        status: 'read'
      }
    });
    
    const warning = !userBook ? 'Вы не отметили эту книгу как прочитанную. Вы уверены, что хотите написать рецензию?' : null;
    
    res.render('reviews/new', {
      title: `Рецензия на книгу: ${book.title}`,
      book,
      warning,
      errors: [], 
      rating: null,
      content: ''
    });
    
  } catch (error) {
    console.error('Ошибка при загрузке формы:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect(`/books/${req.params.bookId}`);
  }
};

exports.postNewReview = async (req, res) => {
  try {
    const bookId = req.params.bookId;
    const userId = req.session.user.id;
    const { rating, content } = req.body;
    
    const errors = [];
    
    if (!rating || rating < 1 || rating > 5) {
      errors.push({ msg: 'Пожалуйста, поставьте оценку от 1 до 5' });
    }
    
    if (!content || content.trim().length < 10) {
      errors.push({ msg: 'Рецензия должна содержать минимум 10 символов' });
    }
    
    if (content && content.length > 5000) {
      errors.push({ msg: 'Рецензия не может быть длиннее 5000 символов' });
    }
    
    const existingReview = await Review.findOne({
      where: { user_id: userId, book_id: bookId }
    });
    
    if (existingReview) {
      errors.push({ msg: 'Вы уже написали рецензию на эту книгу' });
    }
    
    if (errors.length > 0) {
      const book = await Book.findByPk(bookId);
      return res.render('reviews/new', {
        title: `Рецензия на книгу: ${book.title}`,
        book,
        errors,
        rating: rating || null,      
        content: content || ''        
      });
    }
    
    const userBook = await UserBook.findOne({
      where: {
        user_id: userId,
        book_id: bookId
      }
    });
    
    if (!userBook) {
      await UserBook.create({
        user_id: userId,
        book_id: bookId,
        status: 'read'
      });
    } else if (userBook.status !== 'read') {
      await userBook.update({ status: 'read' });
    }
    
    await Review.create({
      user_id: userId,
      book_id: bookId,
      rating: parseInt(rating),
      content: content.trim(),
      likes_count: 0,
      dislikes_count: 0,
      is_moderated: false // Требуется модерация
    });
    
    await updateBookRating(bookId);
    
    req.flash('success', 'Рецензия успешно отправлена на модерацию');
    res.redirect(`/books/${bookId}`);
    
  } catch (error) {
    console.error('Ошибка при сохранении рецензии:', error);
    req.flash('error', 'Произошла ошибка при сохранении рецензии');
    res.redirect(`/books/${req.params.bookId}/review/new`);
  }
};

exports.getEditReview = async (req, res) => {
  try {
    const reviewId = req.params.id;
    const userId = req.session.user.id;
    
    const review = await Review.findOne({
      where: { id: reviewId, user_id: userId },
      include: [{ model: Book, as: 'book' }]
    });
    
    if (!review) {
      req.flash('error', 'Рецензия не найдена');
      return res.redirect('/profile/reviews');
    }
    
    res.render('reviews/edit', {
      title: 'Редактирование рецензии',
      review: {
        ...review.toJSON(),
        rating: review.rating,
        content: review.content
      },
      errors: [],
      rating: review.rating,
      content: review.content
    });
    
  } catch (error) {
    console.error('Ошибка при загрузке формы:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/profile/reviews');
  }
};

exports.postEditReview = async (req, res) => {
  try {
    const reviewId = req.params.id;
    const userId = req.session.user.id;
    const { rating, content } = req.body;
    
    const errors = [];
    
    if (!rating || rating < 1 || rating > 5) {
      errors.push({ msg: 'Пожалуйста, поставьте оценку от 1 до 5' });
    }
    
    if (!content || content.trim().length < 10) {
      errors.push({ msg: 'Рецензия должна содержать минимум 10 символов' });
    }
    
    const review = await Review.findOne({
      where: { id: reviewId, user_id: userId }
    });
    
    if (!review) {
      req.flash('error', 'Рецензия не найдена');
      return res.redirect('/profile/reviews');
    }
    
    if (errors.length > 0) {
      const book = await Book.findByPk(review.book_id);
      return res.render('reviews/edit', {
        title: 'Редактирование рецензии',
        review: { ...review.toJSON(), book },
        errors,
        rating: rating || review.rating,
        content: content || review.content
      });
    }
    
    const bookId = review.book_id;
    
    await review.update({
      rating: parseInt(rating),
      content: content.trim(),
      is_moderated: false
    });
    
    await updateBookRating(bookId);
    
    req.flash('success', 'Рецензия обновлена и отправлена на модерацию');
    res.redirect('/profile/reviews');
    
  } catch (error) {
    console.error('Ошибка при обновлении рецензии:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect(`/reviews/${req.params.id}/edit`);
  }
};

exports.deleteReview = async (req, res) => {
  try {
    const reviewId = req.params.id;
    const userId = req.session.user.id;
    
    const review = await Review.findOne({
      where: { id: reviewId, user_id: userId }
    });
    
    if (!review) {
      req.flash('error', 'Рецензия не найдена');
      return res.redirect('/profile/reviews');
    }
    
    const bookId = review.book_id;
    
    await review.destroy();
    
    await updateBookRating(bookId);
    
    req.flash('success', 'Рецензия удалена');
    res.redirect('/profile/reviews');
    
  } catch (error) {
    console.error('Ошибка при удалении рецензии:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/profile/reviews');
  }
};

exports.rateReview = async (req, res) => {
  try {
    const reviewId = req.params.id;
    const userId = req.session.user.id;
    const { type } = req.body; // 'like' или 'dislike'
    
    if (!userId) {
      return res.status(401).json({ error: 'Требуется авторизация' });
    }
    
    const review = await Review.findByPk(reviewId);
    
    if (!review) {
      return res.status(404).json({ error: 'Рецензия не найдена' });
    }
    
    const existingLike = await ReviewLike.findOne({
      where: {
        user_id: userId,
        review_id: reviewId
      }
    });
    
    let action = 'created';
    
    if (existingLike) {
      if (existingLike.type === type) {
        await existingLike.destroy();
        action = 'removed';
      } else {
        await existingLike.update({ type });
        action = 'updated';
      }
    } else {
      await ReviewLike.create({
        user_id: userId,
        review_id: reviewId,
        type
      });
      action = 'created';
    }
    
    const likesCount = await ReviewLike.count({
      where: {
        review_id: reviewId,
        type: 'like'
      }
    });
    
    const dislikesCount = await ReviewLike.count({
      where: {
        review_id: reviewId,
        type: 'dislike'
      }
    });
    
    await review.update({
      likes_count: likesCount,
      dislikes_count: dislikesCount
    });
    
    if (action !== 'removed' && review.user_id !== userId) {
      await notificationService.reviewLiked(reviewId, userId, type);
    }

    let userReaction = null;
    if (existingLike) {
      userReaction = existingLike.type;
      if (action === 'removed') {
        userReaction = null;
      } else if (action === 'updated') {
        userReaction = type;
      }
    } else if (action === 'created') {
      userReaction = type;
    }
    
    res.json({
      success: true,
      likes: likesCount,
      dislikes: dislikesCount,
      userReaction: userReaction,
      action: action
    });
    
  } catch (error) {
    console.error('Ошибка при оценке рецензии:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
};

exports.approveReview = async (req, res) => {
  try {
    const reviewId = req.params.id;
    
    if (!req.session.user || (req.session.user.role !== 'admin' && req.session.user.role !== 'moderator')) {
      req.flash('error', 'Недостаточно прав');
      return res.redirect('/admin/reviews');
    }
    
    const review = await Review.findByPk(reviewId);
    
    if (!review) {
      req.flash('error', 'Рецензия не найдена');
      return res.redirect('/admin/reviews');
    }
    
    await review.update({ is_moderated: true });
    
    await updateBookRating(review.book_id);
    
    req.flash('success', 'Рецензия одобрена');
    res.redirect('/admin/reviews');
    
  } catch (error) {
    console.error('Ошибка при одобрении рецензии:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/admin/reviews');
  }
};

exports.rejectReview = async (req, res) => {
  try {
    const reviewId = req.params.id;
    
    if (!req.session.user || (req.session.user.role !== 'admin' && req.session.user.role !== 'moderator')) {
      req.flash('error', 'Недостаточно прав');
      return res.redirect('/admin/reviews');
    }
    
    const review = await Review.findByPk(reviewId);
    
    if (!review) {
      req.flash('error', 'Рецензия не найдена');
      return res.redirect('/admin/reviews');
    }
    
    const bookId = review.book_id;
    await review.destroy();
    
    await updateBookRating(bookId);
    
    req.flash('success', 'Рецензия отклонена и удалена');
    res.redirect('/admin/reviews');
    
  } catch (error) {
    console.error('Ошибка при отклонении рецензии:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/admin/reviews');
  }
};

exports.updateAllRatings = async (req, res) => {
  try {
    if (!req.session.user || req.session.user.role !== 'admin') {
      req.flash('error', 'Недостаточно прав');
      return res.redirect('/admin');
    }
    
    const books = await Book.findAll();
    let updatedCount = 0;
    
    for (const book of books) {
      await updateBookRating(book.id);
      updatedCount++;
    }
    
    req.flash('success', `Обновлены рейтинги ${updatedCount} книг`);
    res.redirect('/admin/statistics');
    
  } catch (error) {
    console.error('Ошибка при массовом обновлении:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/admin');
  }
};
