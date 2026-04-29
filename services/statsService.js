const { Book, User, Review } = require('../models');

const EMPTY_STATS = {
  totalBooks: 0,
  totalUsers: 0,
  totalReviews: 0
};

const getSiteStats = async () => {
  const [totalBooks, totalUsers, totalReviews] = await Promise.all([
    Book.count(),
    User.count(),
    Review.count()
  ]);

  return { totalBooks, totalUsers, totalReviews };
};

module.exports = {
  EMPTY_STATS,
  getSiteStats
};
