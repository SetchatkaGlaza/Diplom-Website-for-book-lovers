'use strict';

const { DataTypes } = require('sequelize');

/**
 * Цитата из книги: до 300 знаков и обязательно с указанием книги.
 *
 * Ограничение в 300 знаков выбрано не случайно: короткая цитата в научных,
 * полемических и информационных целях допустима по ст. 1274 ГК РФ,
 * а полный текст — уже нарушение (ст. 1301). Поэтому длина проверяется
 * и в модели, и в форме, и в сервисе.
 */
module.exports = (sequelize) => {
  const Quote = sequelize.define('Quote', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    bookId: { type: DataTypes.INTEGER, allowNull: false },
    body: { type: DataTypes.STRING(300), allowNull: false, validate: { len: [3, 300] } },
    page: { type: DataTypes.INTEGER, allowNull: true },
    likesCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    state: {
      type: DataTypes.ENUM('published', 'hidden'),
      allowNull: false,
      defaultValue: 'published'
    }
  }, {
    tableName: 'quotes',
    indexes: [
      { fields: ['book_id', 'created_at'] },
      { fields: ['user_id', 'created_at'] }
    ]
  });

  Quote.MAX_LENGTH = 300;

  return Quote;
};
