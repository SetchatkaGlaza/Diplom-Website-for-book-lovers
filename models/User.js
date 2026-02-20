const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const User = sequelize.define('User', {
  // id создастся автоматически
  name: {
    type: DataTypes.STRING,
    allowNull: false, // обязательно для заполнения
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true, // email должен быть уникальным
    validate: {
      isEmail: true, // проверка, что это email
    },
  },
  password_hash: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  role: {
    type: DataTypes.ENUM('user', 'admin', 'moderator'),
    defaultValue: 'user', // по умолчанию обычный пользователь
  },
  avatar: {
    type: DataTypes.STRING,
    defaultValue: 'default-avatar.png',
  },
}, {
  // Добавит поля createdAt и updatedAt автоматически
  timestamps: true,
});

module.exports = User;