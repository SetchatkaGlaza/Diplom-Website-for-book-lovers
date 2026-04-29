const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ForumTopic = sequelize.define('ForumTopic', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  category_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'forum_categories',
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
  title: {
    type: DataTypes.STRING(200),
    allowNull: false,
    validate: {
      len: [5, 200]
    }
  },
  slug: {
    type: DataTypes.STRING(200),
    allowNull: false,
    unique: true
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  views: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  is_pinned: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  is_locked: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  is_moderated: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  last_reply_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  last_reply_user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  replies_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  }
}, {
  timestamps: true,
  tableName: 'forum_topics',
  indexes: [
    {
      fields: ['category_id']
    },
    {
      fields: ['user_id']
    },
    {
      fields: ['slug']
    },
    {
      fields: ['last_reply_at']
    }
  ]
});

module.exports = ForumTopic;
