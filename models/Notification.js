const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Notification = sequelize.define('Notification', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  type: {
    type: DataTypes.ENUM(
      'review_moderated',
      'new_review',
      'review_liked',
      'book_imported',
      'system',
      'welcome'
    ),
    defaultValue: 'system'
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  link: {
    type: DataTypes.STRING,
    allowNull: true
  },
  is_read: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  data: {
    type: DataTypes.JSONB,
    allowNull: true
  }
}, {
  timestamps: true,
  tableName: 'notifications'
});

module.exports = Notification;