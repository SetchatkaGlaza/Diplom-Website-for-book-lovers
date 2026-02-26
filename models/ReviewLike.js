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
    }
  },
  review_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'Reviews',
      key: 'id'
    }
  },
  type: {
    type: DataTypes.ENUM('like', 'dislike'),
    allowNull: false
  }
}, {
  timestamps: true,
  // Составной уникальный индекс: один пользователь - один лайк/дизлайк на рецензию
  indexes: [
    {
      unique: true,
      fields: ['user_id', 'review_id']
    }
  ]
});

module.exports = ReviewLike;