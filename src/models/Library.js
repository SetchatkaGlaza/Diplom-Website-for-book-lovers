'use strict';

const { DataTypes } = require('sequelize');

const SHELF_STATUSES = ['want', 'reading', 'read', 'dnf'];

module.exports = (sequelize) => {
  const LibraryEntry = sequelize.define('LibraryEntry', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    bookId: { type: DataTypes.INTEGER, allowNull: false },
    status: {
      type: DataTypes.ENUM(...SHELF_STATUSES),
      allowNull: false,
      defaultValue: 'want'
    },
    progressPages: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    startedAt: { type: DataTypes.DATE, allowNull: true },
    finishedAt: { type: DataTypes.DATE, allowNull: true },
    rereadCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    isFavorite: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
  }, {
    tableName: 'library_entries',
    indexes: [
      { unique: true, fields: ['user_id', 'book_id'] },
      { fields: ['user_id', 'status'] },
      { fields: ['book_id', 'status'] },
      { fields: ['user_id', 'finished_at'] }
    ]
  });

  LibraryEntry.STATUSES = SHELF_STATUSES;

  return LibraryEntry;
};

module.exports.SHELF_STATUSES = SHELF_STATUSES;
