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
const Notification = require('./Notification');
const ForumCategory = require('./ForumCategory');
const ForumTopic = require('./ForumTopic');
const ForumPost = require('./ForumPost');
const ForumPostLike = require('./ForumPostLike');
const ForumSubscription = require('./ForumSubscription');

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
  PasswordReset,
  Notification,
  ForumCategory,
  ForumTopic,
  ForumPost,
  ForumPostLike,
  ForumSubscription
};