'use strict';

const { DataTypes } = require('sequelize');

/**
 * Денормализованная лента событий: пишется при действиях пользователей,
 * читается одним запросом для ленты «друзья читают».
 */
module.exports = (sequelize) => {
  const Activity = sequelize.define('Activity', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    type: {
      type: DataTypes.ENUM('shelf', 'finished', 'review', 'club_join', 'club_post', 'follow'),
      allowNull: false
    },
    bookId: { type: DataTypes.INTEGER, allowNull: true },
    reviewId: { type: DataTypes.INTEGER, allowNull: true },
    clubId: { type: DataTypes.INTEGER, allowNull: true },
    meta: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
  }, {
    tableName: 'activities',
    indexes: [
      { fields: ['user_id', 'created_at'] },
      { fields: ['created_at'] }
    ]
  });

  return Activity;
};
