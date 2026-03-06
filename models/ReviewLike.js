const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ReviewLike = sequelize.define('ReviewLike', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'Users',
      key: 'id'
    },
    onDelete: 'CASCADE'
  },
  review_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'Reviews',
      key: 'id'
    },
    onDelete: 'CASCADE'
  },
  type: {
    type: DataTypes.ENUM('like', 'dislike'),
    allowNull: false
  }
}, {
  timestamps: true,
  tableName: 'ReviewLikes',
  indexes: [
    {
      name: 'review_likes_unique_user_review',
      unique: true,
      fields: ['user_id', 'review_id']
    }
  ]
});

module.exports = ReviewLike;