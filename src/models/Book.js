'use strict';

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Book = sequelize.define('Book', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    slug: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    title: { type: DataTypes.STRING(255), allowNull: false },
    author: { type: DataTypes.STRING(160), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    year: { type: DataTypes.INTEGER, allowNull: true },
    pages: { type: DataTypes.INTEGER, allowNull: true },
    publisher: { type: DataTypes.STRING(160), allowNull: true },
    isbn: { type: DataTypes.STRING(20), allowNull: true },
    cover: { type: DataTypes.STRING(255), allowNull: false, defaultValue: 'default-cover.svg' },
    // агрегаты, пересчитываются при изменении оценок
    ratingsCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    ratingsSum: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    reviewsCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    shelvesCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    viewsCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    isPublished: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdByUserId: { type: DataTypes.INTEGER, allowNull: true }
  }, {
    tableName: 'books',
    indexes: [
      { fields: ['author'] },
      { fields: ['year'] },
      { fields: ['ratings_count'] },
      { fields: ['shelves_count'] },
      { fields: ['title'] }
    ]
  });

  Book.prototype.getAverageRating = function getAverageRating() {
    if (!this.ratingsCount) return 0;
    return Math.round((this.ratingsSum / this.ratingsCount) * 10) / 10;
  };

  Book.prototype.toCardJSON = function toCardJSON() {
    return {
      id: this.id,
      slug: this.slug,
      title: this.title,
      author: this.author,
      cover: this.cover,
      year: this.year,
      pages: this.pages,
      rating: this.getAverageRating(),
      ratingsCount: this.ratingsCount,
      reviewsCount: this.reviewsCount
    };
  };

  return Book;
};
