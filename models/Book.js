const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const Genre = require('./Genre');

const Book = sequelize.define('Book', {
  title: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      len: [1, 255]        // название не длиннее 255 символов
    }
  },
  author: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      len: [2, 100]
    }
  },
  ratings_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,   // TEXT может быть очень длинным
    allowNull: true         // может быть пустым
  },
  year: {
    type: DataTypes.INTEGER,
    allowNull: true,
    validate: {
      min: 1000,            // не раньше 1000 года
      max: new Date().getFullYear() + 1 // не позже следующего года
    }
  },
  pages: {
    type: DataTypes.INTEGER,
    allowNull: true,
    validate: {
      min: 1,
      max: 10000
    }
  },
  publisher: {
    type: DataTypes.STRING,
    allowNull: true
  },
  cover_image: {
    type: DataTypes.STRING,
    defaultValue: 'default-book-cover.jpg', // если нет обложки
    allowNull: false
  },
  views_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,         // при создании 0 просмотров
    allowNull: false
  }
}, {
  timestamps: true
});

/**
 * Получить средний рейтинг и количество оценок
 */
Book.prototype.getRatingInfo = async function() {
  const reviews = await this.getReviews({
    where: { is_moderated: true },
    attributes: ['rating']
  });
  
  const count = reviews.length;
  
  if (count === 0) {
    return {
      average: 0,
      count: 0,
      distribution: {
        1: 0, 2: 0, 3: 0, 4: 0, 5: 0
      }
    };
  }
  
  // Считаем сумму для среднего
  const sum = reviews.reduce((acc, review) => acc + review.rating, 0);
  const average = (sum / count).toFixed(1);
  
  // Считаем распределение по звёздам
  const distribution = {
    1: reviews.filter(r => r.rating === 1).length,
    2: reviews.filter(r => r.rating === 2).length,
    3: reviews.filter(r => r.rating === 3).length,
    4: reviews.filter(r => r.rating === 4).length,
    5: reviews.filter(r => r.rating === 5).length
  };
  
  return {
    average: parseFloat(average),
    count,
    distribution
  };
};

// Для обратной совместимости оставим старый метод
Book.prototype.getAverageRating = async function() {
  const info = await this.getRatingInfo();
  return info.average;
};

/**
 * Метод для увеличения просмотров
 */
Book.prototype.incrementViews = async function() {
  this.views_count += 1;
  await this.save();
  return this.views_count;
};

module.exports = Book;