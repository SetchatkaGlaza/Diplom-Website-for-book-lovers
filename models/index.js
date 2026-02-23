const sequelize = require('../config/database');

// Импортируем все модели
const User = require('./User');
const Genre = require('./Genre');
const Book = require('./Book');
const Review = require('./Review');
const UserBook = require('./UserBook');
const ReviewLike = require('./ReviewLike');

// Определяем связи между моделями

// Связи Book и Genre
Book.belongsTo(Genre, {
  foreignKey: 'genre_id',
  as: 'genre'
});

Genre.hasMany(Book, {
  foreignKey: 'genre_id',
  as: 'books'
});

// Связи Review с User и Book
Review.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user'
});

Review.belongsTo(Book, {
  foreignKey: 'book_id',
  as: 'book'
});

User.hasMany(Review, {
  foreignKey: 'user_id',
  as: 'reviews'
});

Book.hasMany(Review, {
  foreignKey: 'book_id',
  as: 'reviews'
});

// Связи UserBook
UserBook.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user'
});

UserBook.belongsTo(Book, {
  foreignKey: 'book_id',
  as: 'book'
});

User.hasMany(UserBook, {
  foreignKey: 'user_id',
  as: 'userBooks'
});

Book.hasMany(UserBook, {
  foreignKey: 'book_id',
  as: 'userBooks'
});

// Связи ReviewLike
ReviewLike.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user'
});

ReviewLike.belongsTo(Review, {
  foreignKey: 'review_id',
  as: 'review'
});

User.hasMany(ReviewLike, {
  foreignKey: 'user_id',
  as: 'reviewLikes'
});

Review.hasMany(ReviewLike, {
  foreignKey: 'review_id',
  as: 'likes'
});

// Экспортируем всё вместе
module.exports = {
  sequelize,
  User,
  Genre,
  Book,
  Review,
  UserBook,
  ReviewLike
};