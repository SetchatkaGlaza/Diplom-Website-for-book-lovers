'use strict';

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Club = sequelize.define('Club', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    slug: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(120), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    cover: { type: DataTypes.STRING(255), allowNull: false, defaultValue: 'default-club.svg' },
    ownerId: { type: DataTypes.INTEGER, allowNull: false },
    isPrivate: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    membersCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    postsCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    currentBookId: { type: DataTypes.INTEGER, allowNull: true },
    lastActivityAt: { type: DataTypes.DATE, allowNull: true }
  }, {
    tableName: 'clubs',
    indexes: [
      { fields: ['owner_id'] },
      { fields: ['members_count'] },
      { fields: ['last_activity_at'] }
    ]
  });

  return Club;
};
