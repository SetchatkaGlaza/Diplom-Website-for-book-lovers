const { Book, User, Review } = require('../models');
const { sequelize } = require('../config/database');

exports.getAbout = async (req, res) => {
  try {
    // Получаем общую статистику
    const [totalBooks, totalUsers, totalReviews] = await Promise.all([
      Book.count(),
      User.count(),
      Review.count()
    ]);
    
    // Получаем последние добавленные книги
    const recentBooks = await Book.findAll({
      order: [['createdAt', 'DESC']],
      limit: 6
    });
    
    // Получаем самых активных пользователей
    const topUsers = await Review.findAll({
      attributes: [
        'user_id',
        [sequelize.fn('COUNT', sequelize.col('Review.id')), 'reviewsCount']
      ],
      include: [{
        model: User,
        as: 'user',
        attributes: ['id', 'name', 'avatar']
      }],
      group: ['user_id', 'user.id'],
      order: [[sequelize.fn('COUNT', sequelize.col('Review.id')), 'DESC']],
      limit: 5
    });
    
    res.render('about', {
      title: 'О проекте',
      stats: {
        totalBooks,
        totalUsers,
        totalReviews
      },
      recentBooks,
      topUsers: topUsers.map(item => ({
        ...item.user.toJSON(),
        reviewsCount: item.dataValues.reviewsCount
      }))
    });
    
  } catch (error) {
    console.error('Ошибка при загрузке страницы "О проекте":', error);
    res.render('about', {
      title: 'О проекте',
      stats: {
        totalBooks: 0,
        totalUsers: 0,
        totalReviews: 0
      },
      recentBooks: [],
      topUsers: []
    });
  }
};