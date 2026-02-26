const { Book } = require('../models');

/**
 * Middleware для подсчёта просмотров книг
 * Увеличивает счётчик просмотров при каждом посещении страницы книги
 */
exports.countBookView = async (req, res, next) => {
  try {
    // Проверяем, что это запрос к странице книги
    if (req.path.match(/^\/books\/\d+$/)) {
      const bookId = req.params.id;
      
      // Увеличиваем счётчик просмотров
      await Book.increment('views_count', { 
        where: { id: bookId } 
      });
      
      console.log(`📊 Просмотр книги #${bookId} засчитан`);
    }
    next();
  } catch (error) {
    console.error('Ошибка при подсчёте просмотров:', error);
    next(); // Продолжаем выполнение даже при ошибке
  }
};