const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Genre = sequelize.define('Genre', {
  name: {
    type: DataTypes.STRING,
    allowNull: false,      // не может быть пустым
    unique: true,           // названия жанров должны быть уникальными
    validate: {
      len: [2, 50]          // длина от 2 до 50 символов
    }
  }
}, {
  timestamps: true          // createdAt и updatedAt
});

/**
 * Получить количество книг в жанре
 */
Genre.prototype.getBooksCount = async function() {
  return await this.countBooks();
};

module.exports = Genre;