const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ForumPostLike = sequelize.define('ForumPostLike', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  post_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'forum_posts',
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
  tableName: 'forum_post_likes',
  indexes: [
    {
      unique: true,
      fields: ['post_id', 'user_id']
    }
  ]
});

module.exports = ForumPostLike;
