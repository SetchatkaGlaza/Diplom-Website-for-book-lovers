'use strict';

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ClubPost = sequelize.define('ClubPost', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    clubId: { type: DataTypes.INTEGER, allowNull: false },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: false, validate: { len: [1, 8000] } },
    // chapter отметки, чтобы обсуждение было привязано к главе
    chapter: { type: DataTypes.INTEGER, allowNull: true },
    hasSpoilers: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    state: {
      type: DataTypes.ENUM('published', 'hidden'),
      allowNull: false,
      defaultValue: 'published'
    }
  }, {
    tableName: 'club_posts',
    indexes: [
      { fields: ['club_id', 'created_at'] },
      { fields: ['user_id'] }
    ]
  });

  return ClubPost;
};
