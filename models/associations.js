const User = require('./User');
const Genre = require('./Genre');
const Book = require('./Book');
const Review = require('./Review');
const UserBook = require('./UserBook');
const ReviewLike = require('./ReviewLike');
const PasswordReset = require('./PasswordReset');
const LoginAttempt = require('./LoginAttempt');
const Notification = require('./Notification');
const ForumCategory = require('./ForumCategory');
const ForumTopic = require('./ForumTopic');
const ForumPost = require('./ForumPost');
const ForumPostLike = require('./ForumPostLike');
const ForumSubscription = require('./ForumSubscription');

/**
 * Этот файл устанавливает связи между моделями
 * Важно: все модели уже должны быть импортированы!
 */
PasswordReset.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user',
  onDelete: 'CASCADE'
});

ForumCategory.hasMany(ForumTopic, {
  foreignKey: 'category_id',
  as: 'topics',
  onDelete: 'CASCADE'
});

ForumTopic.belongsTo(ForumCategory, {
  foreignKey: 'category_id',
  as: 'category'
});

// Пользователь - Темы
User.hasMany(ForumTopic, {
  foreignKey: 'user_id',
  as: 'forumTopics',
  onDelete: 'CASCADE'
});

ForumTopic.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user'
});

// Пользователь - Последний ответ в теме
ForumTopic.belongsTo(User, {
  foreignKey: 'last_reply_user_id',
  as: 'lastReplyUser'
});

// Тема - Сообщения
ForumTopic.hasMany(ForumPost, {
  foreignKey: 'topic_id',
  as: 'posts',
  onDelete: 'CASCADE'
});

ForumPost.belongsTo(ForumTopic, {
  foreignKey: 'topic_id',
  as: 'topic'
});

// Пользователь - Сообщения
User.hasMany(ForumPost, {
  foreignKey: 'user_id',
  as: 'forumPosts',
  onDelete: 'CASCADE'
});

ForumPost.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user'
});

// Кто редактировал сообщение
ForumPost.belongsTo(User, {
  foreignKey: 'edited_by',
  as: 'editor'
});

// Лайки сообщений
ForumPost.hasMany(ForumPostLike, {
  foreignKey: 'post_id',
  as: 'likes',
  onDelete: 'CASCADE'
});

ForumPostLike.belongsTo(ForumPost, {
  foreignKey: 'post_id',
  as: 'post'
});

User.hasMany(ForumPostLike, {
  foreignKey: 'user_id',
  as: 'forumPostLikes',
  onDelete: 'CASCADE'
});

ForumPostLike.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user'
});

// Подписки на темы
ForumTopic.hasMany(ForumSubscription, {
  foreignKey: 'topic_id',
  as: 'subscriptions',
  onDelete: 'CASCADE'
});

ForumSubscription.belongsTo(ForumTopic, {
  foreignKey: 'topic_id',
  as: 'topic'
});

User.hasMany(ForumSubscription, {
  foreignKey: 'user_id',
  as: 'forumSubscriptions',
  onDelete: 'CASCADE'
});

ForumSubscription.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user'
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
  Notification,
  ForumCategory,
  ForumTopic,
  ForumPost,
  ForumPostLike,
  ForumSubscription
};