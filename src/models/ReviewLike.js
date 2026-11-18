'use strict';

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ReviewLike = sequelize.define('ReviewLike', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    reviewId: { type: DataTypes.INTEGER, allowNull: false },
    userId: { type: DataTypes.INTEGER, allowNull: false }
  }, {
    tableName: 'review_likes',
    indexes: [{ unique: true, fields: ['review_id', 'user_id'] }]
  });

  return ReviewLike;
};
