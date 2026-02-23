const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const Genre = require('./Genre');

const Book = sequelize.define('Book', {
  title: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      len: [1, 255]        // название не длиннее 255 символов
    }
  },
  author: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      len: [2, 100]
    }
  },
  description: {
    type: DataTypes.TEXT,   // TEXT может быть очень длинным
    allowNull: true         // может быть пустым
  },
  year: {
    type: DataTypes.INTEGER,
    allowNull: true,
    validate: {
      min: 1000,            // не раньше 1000 года
      max: new Date().getFullYear() + 1 // не позже следующего года
    }
  },
  pages: {
    type: DataTypes.INTEGER,
    allowNull: true,
    validate: {
      min: 1,
      max: 10000
    }
  },
  publisher: {
    type: DataTypes.STRING,
    allowNull: true
  },
  cover_image: {
    type: DataTypes.STRING,
    defaultValue: 'default-book-cover.jpg' // если нет обложки
  },
  views_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,         // при создании 0 просмотров
    allowNull: false
  }
}, {
  timestamps: true
});

module.exports = Book;