const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ReviewLike = sequelize.define('ReviewLike', {
  type: {
    type: DataTypes.ENUM('like', 'dislike'),
    allowNull: false
  }
}, {
  timestamps: true
});

module.exports = ReviewLike;