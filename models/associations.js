const User = require('./User');
const Genre = require('./Genre');
const Book = require('./Book');
const Review = require('./Review');
const UserBook = require('./UserBook');
const ReviewLike = require('./ReviewLike');
const PasswordReset = require('./PasswordReset');
const LoginAttempt = require('./LoginAttempt');
const Notification = require('./Notification'); 

/**
 * Этот файл устанавливает связи между моделями
 * Важно: все модели уже должны быть импортированы!
 */
PasswordReset.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user',
  onDelete: 'CASCADE'
});

Notification.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user',
  onDelete: 'CASCADE'
});

User.hasMany(Notification, {
  foreignKey: 'user_id',
  as: 'notifications',
  onDelete: 'CASCADE'
});

User.hasMany(PasswordReset, {
  foreignKey: 'user_id',
  as: 'passwordResets',
  onDelete: 'CASCADE'
});

LoginAttempt.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user',
  onDelete: 'CASCADE'
});

User.hasMany(LoginAttempt, {
  foreignKey: 'user_id',
  as: 'loginAttempts',
  onDelete: 'CASCADE'
});

Book.belongsTo(Genre, {
  foreignKey: 'genre_id',
  as: 'genre'
});

Genre.hasMany(Book, {
  foreignKey: 'genre_id',
  as: 'books'
});

Review.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user',
  onDelete: 'CASCADE'
});

Review.belongsTo(Book, {
  foreignKey: 'book_id',
  as: 'book',
  onDelete: 'CASCADE'
});

User.hasMany(Review, {
  foreignKey: 'user_id',
  as: 'reviews',
  onDelete: 'CASCADE'
});

Book.hasMany(Review, {
  foreignKey: 'book_id',
  as: 'reviews',
  onDelete: 'CASCADE'
});

UserBook.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user',
  onDelete: 'CASCADE'
});

UserBook.belongsTo(Book, {
  foreignKey: 'book_id',
  as: 'book',
  onDelete: 'CASCADE'
});

User.hasMany(UserBook, {
  foreignKey: 'user_id',
  as: 'userBooks',
  onDelete: 'CASCADE'
});

Book.hasMany(UserBook, {
  foreignKey: 'book_id',
  as: 'userBooks',
  onDelete: 'CASCADE'
});

ReviewLike.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user',
  onDelete: 'CASCADE'
});

ReviewLike.belongsTo(Review, {
  foreignKey: 'review_id',
  as: 'review',
  onDelete: 'CASCADE'
});

User.hasMany(ReviewLike, {
  foreignKey: 'user_id',
  as: 'reviewReactions',
  onDelete: 'CASCADE'
});

Review.hasMany(ReviewLike, {
  foreignKey: 'review_id',
  as: 'reactions',
  onDelete: 'CASCADE'
});

User.belongsToMany(Review, {
  through: ReviewLike,
  foreignKey: 'user_id',
  otherKey: 'review_id',
  as: 'votedReviews'
});

Review.belongsToMany(User, {
  through: ReviewLike,
  foreignKey: 'review_id',
  otherKey: 'user_id',
  as: 'voters'
});

console.log('✅ Все связи между моделями установлены');

module.exports = {
  User,
  Genre,
  Book,
  Review,
  UserBook,
  ReviewLike,
  PasswordReset,
  LoginAttempt,
  Notification
};