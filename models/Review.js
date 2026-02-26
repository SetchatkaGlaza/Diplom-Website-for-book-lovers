const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Review = sequelize.define('Review', {
  rating: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: {
      min: 1,
      max: 5
    }
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: {
      len: [10, 5000]       // рецензия от 10 до 5000 символов
    }
  },
  likes_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false
  },
  dislikes_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false
  },
  is_moderated: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,    // по умолчанею не промодерировано
    allowNull: false
  }
}, {
  timestamps: true
});


module.exports = Review;