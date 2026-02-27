const sequelize = require('../config/database');

// Импортируем модели в правильном порядке
const User = require('./User');
const Genre = require('./Genre');
const Book = require('./Book');
const Review = require('./Review');
const UserBook = require('./UserBook');
const ReviewLike = require('./ReviewLike');
const LoginAttempt = require('./LoginAttempt');
const PasswordReset = require('./PasswordReset');

// Устанавливаем связи
require('./associations');

// Экспортируем всё вместе
module.exports = {
  sequelize,
  User,
  Genre,
  Book,
  Review,
  UserBook,
  ReviewLike,
  LoginAttempt,
  PasswordReset
};