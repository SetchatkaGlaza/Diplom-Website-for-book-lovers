const User = require('./User');
const Genre = require('./Genre');
const Book = require('./Book');
const Review = require('./Review');
const UserBook = require('./UserBook');
const ReviewLike = require('./ReviewLike');

/**
 * Этот файл устанавливает связи между моделями
 * Важно: все модели уже должны быть импортированы!
 */

// Связи Book - Genre
Book.belongsTo(Genre, {
  foreignKey: 'genre_id',
  as: 'genre'
});

Genre.hasMany(Book, {
  foreignKey: 'genre_id',
  as: 'books'
});

// Связи Review - User - Book
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

// Связи UserBook (полки)
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

// Связи ReviewLike (лайки)
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

// Связи многие-ко-многим через ReviewLike
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
  ReviewLike
};