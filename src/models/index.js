'use strict';

const { DataTypes } = require('sequelize');
const { sequelize: defaultSequelize, createSequelize } = require('../config/database');

/**
 * Модели создаются фабрикой от конкретного инстанса Sequelize.
 * Прод использует общий инстанс, тесты — свой (PGlite), поэтому
 * модели и их связи описываются один раз и переиспользуются.
 */
function defineModels(sequelize) {
const User = require('./User')(sequelize);
const Book = require('./Book')(sequelize);
const LibraryEntry = require('./Library')(sequelize);
const Review = require('./Review')(sequelize);
const ReviewLike = require('./ReviewLike')(sequelize);
const ReviewComment = require('./ReviewComment')(sequelize);
const Follow = require('./Follow')(sequelize);
const Club = require('./Club')(sequelize);
const ClubMember = require('./ClubMember')(sequelize);
const ClubPost = require('./ClubPost')(sequelize);
const ClubRequest = require('./ClubRequest')(sequelize);
const ClubInvite = require('./ClubInvite')(sequelize);
const ClubSchedule = require('./ClubSchedule')(sequelize);
const Notification = require('./Notification')(sequelize);
const Activity = require('./Activity')(sequelize);
const ReadingGoal = require('./ReadingGoal')(sequelize);
const Report = require('./Report')(sequelize);
const ModerationLog = require('./ModerationLog')(sequelize);
const Conversation = require('./Conversation')(sequelize);
const Message = require('./Message')(sequelize);
const Token = require('./Token')(sequelize);
const Quote = require('./Quote')(sequelize);
const { Collection, CollectionBook, Author } = require('./Collection')(sequelize);
const Digest = require('./Digest')(sequelize);
const EmailUnsubscribe = require('./EmailUnsubscribe')(sequelize);

const Genre = sequelize.define('Genre', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(60), allowNull: false, unique: true },
  slug: { type: DataTypes.STRING(60), allowNull: false, unique: true },
  sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 }
}, { tableName: 'genres' });

const BookGenre = sequelize.define('BookGenre', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  bookId: { type: DataTypes.INTEGER, allowNull: false },
  genreId: { type: DataTypes.INTEGER, allowNull: false }
}, {
  tableName: 'book_genres',
  indexes: [
    { unique: true, fields: ['book_id', 'genre_id'] },
    { fields: ['genre_id'] }
  ]
});

// --- связи ---
Book.belongsToMany(Genre, { through: BookGenre, as: 'genres', foreignKey: 'bookId', otherKey: 'genreId' });
Genre.belongsToMany(Book, { through: BookGenre, as: 'books', foreignKey: 'genreId', otherKey: 'bookId' });

LibraryEntry.belongsTo(User, { as: 'user', foreignKey: 'userId', onDelete: 'CASCADE' });
LibraryEntry.belongsTo(Book, { as: 'book', foreignKey: 'bookId', onDelete: 'CASCADE' });
User.hasMany(LibraryEntry, { as: 'library', foreignKey: 'userId', onDelete: 'CASCADE' });
Book.hasMany(LibraryEntry, { as: 'entries', foreignKey: 'bookId', onDelete: 'CASCADE' });

Review.belongsTo(User, { as: 'user', foreignKey: 'userId', onDelete: 'CASCADE' });
Review.belongsTo(Book, { as: 'book', foreignKey: 'bookId', onDelete: 'CASCADE' });
User.hasMany(Review, { as: 'reviews', foreignKey: 'userId', onDelete: 'CASCADE' });
Book.hasMany(Review, { as: 'reviews', foreignKey: 'bookId', onDelete: 'CASCADE' });

ReviewLike.belongsTo(Review, { as: 'review', foreignKey: 'reviewId', onDelete: 'CASCADE' });
ReviewLike.belongsTo(User, { as: 'user', foreignKey: 'userId', onDelete: 'CASCADE' });
Review.hasMany(ReviewLike, { as: 'likes', foreignKey: 'reviewId', onDelete: 'CASCADE' });

ReviewComment.belongsTo(Review, { as: 'review', foreignKey: 'reviewId', onDelete: 'CASCADE' });
ReviewComment.belongsTo(User, { as: 'user', foreignKey: 'userId', onDelete: 'CASCADE' });
Review.hasMany(ReviewComment, { as: 'comments', foreignKey: 'reviewId', onDelete: 'CASCADE' });

Follow.belongsTo(User, { as: 'follower', foreignKey: 'followerId', onDelete: 'CASCADE' });
Follow.belongsTo(User, { as: 'following', foreignKey: 'followingId', onDelete: 'CASCADE' });
User.belongsToMany(User, {
  through: Follow, as: 'following', foreignKey: 'followerId', otherKey: 'followingId'
});
User.belongsToMany(User, {
  through: Follow, as: 'followers', foreignKey: 'followingId', otherKey: 'followerId'
});

Club.belongsTo(User, { as: 'owner', foreignKey: 'ownerId', onDelete: 'CASCADE' });
Club.belongsTo(Book, { as: 'currentBook', foreignKey: 'currentBookId', onDelete: 'SET NULL' });
ClubMember.belongsTo(Club, { as: 'club', foreignKey: 'clubId', onDelete: 'CASCADE' });
ClubMember.belongsTo(User, { as: 'user', foreignKey: 'userId', onDelete: 'CASCADE' });
Club.hasMany(ClubMember, { as: 'members', foreignKey: 'clubId', onDelete: 'CASCADE' });
User.hasMany(ClubMember, { as: 'clubMemberships', foreignKey: 'userId', onDelete: 'CASCADE' });

ClubPost.belongsTo(Club, { as: 'club', foreignKey: 'clubId', onDelete: 'CASCADE' });
ClubRequest.belongsTo(Club, { as: 'club', foreignKey: 'clubId', onDelete: 'CASCADE' });
ClubRequest.belongsTo(User, { as: 'user', foreignKey: 'userId', onDelete: 'CASCADE' });
Club.hasMany(ClubRequest, { as: 'requests', foreignKey: 'clubId', onDelete: 'CASCADE' });

ClubInvite.belongsTo(Club, { as: 'club', foreignKey: 'clubId', onDelete: 'CASCADE' });
ClubInvite.belongsTo(User, { as: 'author', foreignKey: 'createdByUserId', onDelete: 'CASCADE' });
Club.hasMany(ClubInvite, { as: 'invites', foreignKey: 'clubId', onDelete: 'CASCADE' });

ClubSchedule.belongsTo(Club, { as: 'club', foreignKey: 'clubId', onDelete: 'CASCADE' });
Club.hasMany(ClubSchedule, { as: 'schedule', foreignKey: 'clubId', onDelete: 'CASCADE' });

ClubPost.belongsTo(User, { as: 'user', foreignKey: 'userId', onDelete: 'CASCADE' });
Club.hasMany(ClubPost, { as: 'posts', foreignKey: 'clubId', onDelete: 'CASCADE' });

Notification.belongsTo(User, { as: 'user', foreignKey: 'userId', onDelete: 'CASCADE' });
User.hasMany(Notification, { as: 'notifications', foreignKey: 'userId', onDelete: 'CASCADE' });

Activity.belongsTo(User, { as: 'user', foreignKey: 'userId', onDelete: 'CASCADE' });
Activity.belongsTo(Book, { as: 'book', foreignKey: 'bookId', onDelete: 'CASCADE' });
Activity.belongsTo(Review, { as: 'review', foreignKey: 'reviewId', onDelete: 'CASCADE' });
Activity.belongsTo(Club, { as: 'club', foreignKey: 'clubId', onDelete: 'SET NULL' });

ReadingGoal.belongsTo(User, { as: 'user', foreignKey: 'userId', onDelete: 'CASCADE' });

ModerationLog.belongsTo(User, { as: 'actor', foreignKey: 'actorId', onDelete: 'SET NULL' });
Report.belongsTo(User, { as: 'reporter', foreignKey: 'reporterId', onDelete: 'CASCADE' });
Report.belongsTo(User, { as: 'resolver', foreignKey: 'resolvedByUserId', onDelete: 'SET NULL' });

Conversation.belongsTo(User, { as: 'userA', foreignKey: 'userAId', onDelete: 'CASCADE' });
Conversation.belongsTo(User, { as: 'userB', foreignKey: 'userBId', onDelete: 'CASCADE' });
Conversation.hasMany(Message, { as: 'messages', foreignKey: 'conversationId', onDelete: 'CASCADE' });
Message.belongsTo(Conversation, { as: 'conversation', foreignKey: 'conversationId', onDelete: 'CASCADE' });
Message.belongsTo(User, { as: 'sender', foreignKey: 'senderId', onDelete: 'CASCADE' });

Token.belongsTo(User, { as: 'user', foreignKey: 'userId', onDelete: 'CASCADE' });
User.hasMany(Token, { as: 'tokens', foreignKey: 'userId', onDelete: 'CASCADE' });

Quote.belongsTo(User, { as: 'user', foreignKey: 'userId', onDelete: 'CASCADE' });
// Подборки: книги входят в них через связку с порядком
Collection.belongsToMany(Book, { through: CollectionBook, as: 'books', foreignKey: 'collectionId', otherKey: 'bookId' });
Book.belongsToMany(Collection, { through: CollectionBook, as: 'collections', foreignKey: 'bookId', otherKey: 'collectionId' });
CollectionBook.belongsTo(Collection, { as: 'collection', foreignKey: 'collectionId', onDelete: 'CASCADE' });
CollectionBook.belongsTo(Book, { as: 'book', foreignKey: 'bookId', onDelete: 'CASCADE' });
Collection.hasMany(CollectionBook, { as: 'items', foreignKey: 'collectionId', onDelete: 'CASCADE' });
Quote.belongsTo(Book, { as: 'book', foreignKey: 'bookId', onDelete: 'CASCADE' });
User.hasMany(Quote, { as: 'quotes', foreignKey: 'userId', onDelete: 'CASCADE' });
Book.hasMany(Quote, { as: 'quotes', foreignKey: 'bookId', onDelete: 'CASCADE' });

Digest.belongsTo(User, { as: 'user', foreignKey: 'userId', onDelete: 'CASCADE' });
User.hasMany(Digest, { as: 'digests', foreignKey: 'userId', onDelete: 'CASCADE' });

return {
  User,
  Book,
  Genre,
  BookGenre,
  LibraryEntry,
  Review,
  ReviewLike,
  ReviewComment,
  Follow,
  Club,
  ClubMember,
  ClubPost,
  ClubRequest,
  ClubInvite,
  ClubSchedule,
  Notification,
  Activity,
  ReadingGoal,
  Report,
  ModerationLog,
  Conversation,
  Message,
  Token,
  Quote,
  Collection,
  CollectionBook,
  Author,
  Digest,
  EmailUnsubscribe
};
}

const models = defineModels(defaultSequelize);

module.exports = {
  ...models,
  sequelize: defaultSequelize,
  createSequelize,
  defineModels
};
