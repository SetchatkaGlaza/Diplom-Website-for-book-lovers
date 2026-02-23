const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const UserBook = sequelize.define('UserBook', {
  status: {
    type: DataTypes.ENUM('read', 'want_to_read', 'reading'),
    allowNull: false,
    defaultValue: 'want_to_read'
  }
}, {
  timestamps: true
});

module.exports = UserBook;