'use strict';

const { DataTypes } = require('sequelize');

/** Подборка книг: редакционный список с адресом и описанием. */
module.exports = (sequelize) => {
  const Collection = sequelize.define('Collection', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    slug: { type: DataTypes.STRING(200), allowNull: false, unique: true },
    title: { type: DataTypes.STRING(200), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    isPublished: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 },
    viewsCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }
  }, {
    tableName: 'collections',
    indexes: [{ fields: ['is_published', 'sort_order'] }]
  });

  const CollectionBook = sequelize.define('CollectionBook', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    collectionId: { type: DataTypes.INTEGER, allowNull: false },
    bookId: { type: DataTypes.INTEGER, allowNull: false },
    position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    note: { type: DataTypes.STRING(300), allowNull: false, defaultValue: '' }
  }, {
    tableName: 'collection_books',
    indexes: [
      { unique: true, fields: ['collection_id', 'book_id'] },
      { fields: ['book_id'] }
    ]
  });

  const Author = sequelize.define('Author', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    slug: { type: DataTypes.STRING(200), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(160), allowNull: false },
    years: { type: DataTypes.STRING(40), allowNull: false, defaultValue: '' },
    bio: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' }
  }, {
    tableName: 'authors',
    indexes: [{ fields: ['name'] }]
  });

  return { Collection, CollectionBook, Author };
};
