const { Book, User, Review } = require('../models');

module.exports = async (req, res, next) => {
  try {
    // Получаем реальную статистику для подвала
    const totalBooks = await Book.count();
    const totalUsers = await User.count();
    const totalReviews = await Review.count();
    
    // Добавляем в локальные переменные (доступны во всех шаблонах)
    res.locals.footerStats = {
      totalBooks,
      totalUsers,
      totalReviews
    };
    
    next();
  } catch (error) {
    console.error('Ошибка при загрузке статистики для подвала:', error);
    res.locals.footerStats = {
      totalBooks: 0,
      totalUsers: 0,
      totalReviews: 0
    };
    next();
  }
};