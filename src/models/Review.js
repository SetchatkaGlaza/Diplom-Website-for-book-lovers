'use strict';

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Review = sequelize.define('Review', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    bookId: { type: DataTypes.INTEGER, allowNull: false },
    /**
     * Оценка хранится целым числом в половинных шагах: 2 = 1 звезда,
     * 5 = 2.5, 10 = 5 звёзд. Так не появляется ошибок округления,
     * которые неизбежны у дробных чисел с плавающей точкой.
     */
    rating: {
      type: DataTypes.SMALLINT,
      allowNull: false,
      validate: { min: 2, max: 10 }
    },
    title: { type: DataTypes.STRING(160), allowNull: false, defaultValue: '' },
    body: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: { len: [20, 20000] }
    },
    hasSpoilers: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    // published — видно всем; pending — на проверке; hidden — скрыто модератором
    state: {
      type: DataTypes.ENUM('published', 'pending', 'hidden'),
      allowNull: false,
      defaultValue: 'published'
    },
    likesCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    commentsCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    moderationNote: { type: DataTypes.STRING(255), allowNull: true },
    moderatedByUserId: { type: DataTypes.INTEGER, allowNull: true }
  }, {
    tableName: 'reviews',
    indexes: [
      { unique: true, fields: ['user_id', 'book_id'] },
      { fields: ['book_id', 'state', 'created_at'] },
      { fields: ['user_id', 'created_at'] },
      { fields: ['state', 'created_at'] }
    ]
  });

  /** Звёзды для отображения: 7 -> 3.5 */
  Review.prototype.getStars = function getStars() {
    return this.rating / 2;
  };

  /** Обратное преобразование: 3.5 -> 7. Возвращает null, если оценка не по шагу 0.5 */
  Review.toRatingValue = function toRatingValue(stars) {
    const value = Number(stars);
    if (!Number.isFinite(value) || value < 1 || value > 5) return null;
    const doubled = Math.round(value * 2);
    if (Math.abs(value * 2 - doubled) > 1e-9) return null;
    return doubled;
  };

  return Review;
};
