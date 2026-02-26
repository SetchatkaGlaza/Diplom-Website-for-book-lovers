const express = require('express');
const router = express.Router();
const { Book, User, Review } = require('../models');

// API endpoint для получения общей статистики
router.get('/stats', async (req, res) => {
  try {
    const totalBooks = await Book.count();
    const totalUsers = await User.count();
    const totalReviews = await Review.count();
    
    // Суммарное количество просмотров всех книг
    const totalViewsResult = await Book.sum('views_count');
    const totalViews = totalViewsResult || 0;
    
    res.json({
      totalBooks,
      totalUsers,
      totalReviews,
      totalViews
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Ошибка при получении статистики' });
  }
});

module.exports = router;