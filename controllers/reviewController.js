const { Review, Book, User, UserBook, ReviewLike } = require('../models');

/**
 * 1. ФОРМА НАПИСАНИЯ РЕЦЕНЗИИ
 */
exports.getNewReview = async (req, res) => {
  try {
    const bookId = req.params.bookId;
    
    // Проверяем, существует ли книга
    const book = await Book.findByPk(bookId);
    
    if (!book) {
      req.flash('error', 'Книга не найдена');
      return res.redirect('/books');
    }
    
    // Проверяем, не писал ли пользователь уже рецензию на эту книгу
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
    
    // Проверяем, отметил ли пользователь книгу как прочитанную
    const userBook = await UserBook.findOne({
      where: {
        user_id: req.session.user.id,
        book_id: bookId,
        status: 'read'
      }
    });
    
    // Если не отметил как прочитанную, показываем предупреждение
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

/**
 * 2. СОХРАНЕНИЕ РЕЦЕНЗИИ
 */
exports.postNewReview = async (req, res) => {
  try {
    const bookId = req.params.bookId;
    const userId = req.session.user.id;
    const { rating, content } = req.body;
    
    // Валидация
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
    
    // Проверяем, не писал ли уже рецензию
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
    
    // Если пользователь не отметил книгу как прочитанную, но всё равно пишет рецензию,
    // автоматически добавляем книгу в статус "read"
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
    
    // Создаём рецензию
    await Review.create({
      user_id: userId,
      book_id: bookId,
      rating: parseInt(rating),
      content: content.trim(),
      likes_count: 0,
      dislikes_count: 0,
      is_moderated: false // Требуется модерация
    });
    
    req.flash('success', 'Рецензия успешно отправлена на модерацию');
    res.redirect(`/books/${bookId}`);
    
  } catch (error) {
    console.error('Ошибка при сохранении рецензии:', error);
    req.flash('error', 'Произошла ошибка при сохранении рецензии');
    res.redirect(`/books/${req.params.bookId}/review/new`);
  }
};

/**
 * 3. РЕДАКТИРОВАНИЕ РЕЦЕНЗИИ
 */
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
      review
    });
    
  } catch (error) {
    console.error('Ошибка при загрузке формы:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/profile/reviews');
  }
};

/**
 * 4. ОБНОВЛЕНИЕ РЕЦЕНЗИИ
 */
exports.postEditReview = async (req, res) => {
  try {
    const reviewId = req.params.id;
    const userId = req.session.user.id;
    const { rating, content } = req.body;
    
    // Валидация
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
        rating,
        content
      });
    }
    
    // Обновляем рецензию и отправляем на повторную модерацию
    await review.update({
      rating: parseInt(rating),
      content: content.trim(),
      is_moderated: false
    });
    
    req.flash('success', 'Рецензия обновлена и отправлена на модерацию');
    res.redirect('/profile/reviews');
    
  } catch (error) {
    console.error('Ошибка при обновлении рецензии:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect(`/reviews/${req.params.id}/edit`);
  }
};

/**
 * 5. УДАЛЕНИЕ РЕЦЕНЗИИ
 */
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
    
    await review.destroy();
    
    req.flash('success', 'Рецензия удалена');
    res.redirect('/profile/reviews');
    
  } catch (error) {
    console.error('Ошибка при удалении рецензии:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/profile/reviews');
  }
};

/**
 * 6. ОЦЕНКА ПОЛЕЗНОСТИ РЕЦЕНЗИИ (лайк/дизлайк) - новая версия
 */
exports.rateReview = async (req, res) => {
  try {
    const reviewId = req.params.id;
    const userId = req.session.user.id;
    const { type } = req.body; // 'like' или 'dislike'
    
    if (!userId) {
      return res.status(401).json({ error: 'Требуется авторизация' });
    }
    
    // Проверяем, существует ли рецензия
    const review = await Review.findByPk(reviewId);
    
    if (!review) {
      return res.status(404).json({ error: 'Рецензия не найдена' });
    }
    
    // Ищем существующую реакцию пользователя на эту рецензию
    const ReviewLike = require('../models/ReviewLike');
    const existingLike = await ReviewLike.findOne({
      where: {
        user_id: userId,
        review_id: reviewId
      }
    });
    
    let action = 'created';
    
    if (existingLike) {
      if (existingLike.type === type) {
        // Если нажали на ту же кнопку - удаляем реакцию (как переключение)
        await existingLike.destroy();
        action = 'removed';
      } else {
        // Если нажали на другую кнопку - обновляем тип
        await existingLike.update({ type });
        action = 'updated';
      }
    } else {
      // Создаём новую реакцию
      await ReviewLike.create({
        user_id: userId,
        review_id: reviewId,
        type
      });
      action = 'created';
    }
    
    // Пересчитываем количество лайков и дизлайков
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
    
    // Обновляем счётчики в рецензии
    await review.update({
      likes_count: likesCount,
      dislikes_count: dislikesCount
    });
    
    // Определяем текущий статус для пользователя
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