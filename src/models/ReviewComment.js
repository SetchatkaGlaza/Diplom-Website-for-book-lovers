'use strict';

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ReviewComment = sequelize.define('ReviewComment', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    reviewId: { type: DataTypes.INTEGER, allowNull: false },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: false, validate: { len: [2, 4000] } },
    state: {
      type: DataTypes.ENUM('published', 'hidden'),
      allowNull: false,
      defaultValue: 'published'
    }
  }, {
    tableName: 'review_comments',
    indexes: [
      { fields: ['review_id', 'created_at'] },
      { fields: ['user_id'] }
    ]
  });

  return ReviewComment;
};
