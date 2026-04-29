const { EMPTY_STATS, getSiteStats } = require('../services/statsService');

module.exports = async (req, res, next) => {
  try {
    res.locals.footerStats = await getSiteStats();
    next();
  } catch (error) {
    console.error('Ошибка при загрузке статистики для подвала:', error);
    res.locals.footerStats = EMPTY_STATS;
    next();
  }
};
