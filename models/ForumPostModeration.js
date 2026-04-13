const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ForumPostModeration = sequelize.define('ForumPostModeration', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  original_post_id: {
    type: DataTypes.INTEGER,
    allowNull: true
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
    allowNull: false
  },
  delete_reason: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  moderator_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  user_explanation: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('deleted', 'appealed', 'restored', 'kept'),
    allowNull: false,
    defaultValue: 'deleted'
  },
  reviewed_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  reviewed_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  resolution_comment: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  timestamps: true,
  tableName: 'forum_post_moderations',
  indexes: [
    { fields: ['topic_id'] },
    { fields: ['user_id'] },
    { fields: ['status'] }
  ]
});

module.exports = ForumPostModeration;
