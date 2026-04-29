const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ForumSubscription = sequelize.define('ForumSubscription', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  topic_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'forum_topics',
      key: 'id'
    }
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'Users',
      key: 'id'
    }
  }
}, {
  timestamps: true,
  tableName: 'forum_subscriptions',
  indexes: [
    {
      unique: true,
      fields: ['topic_id', 'user_id']
    }
  ]
});

module.exports = ForumSubscription;
