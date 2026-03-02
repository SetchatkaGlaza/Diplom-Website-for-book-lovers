// models/ForumPost.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ForumPost = sequelize.define('ForumPost', {
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
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: {
      len: [2, 10000]
    }
  },
  is_edited: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },

  is_moderated: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  likes_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  ip_address: {
    type: DataTypes.STRING(45),
    allowNull: true
  }
}, {
  timestamps: true,
  tableName: 'forum_posts',
  indexes: [
    {
      fields: ['topic_id']
    },
    {
      fields: ['user_id']
    },
    {
      fields: ['createdAt']
    }
  ]
});

module.exports = ForumPost;