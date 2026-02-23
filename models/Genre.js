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

module.exports = Genre;