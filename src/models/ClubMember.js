'use strict';

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ClubMember = sequelize.define('ClubMember', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    clubId: { type: DataTypes.INTEGER, allowNull: false },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    // Роли клуба. `lead` — старое название ведущего, оставлено для совместимости.
    role: {
      type: DataTypes.ENUM('member', 'lead', 'moderator', 'owner'),
      allowNull: false,
      defaultValue: 'member'
    }
  }, {
    tableName: 'club_members',
    indexes: [
      { unique: true, fields: ['club_id', 'user_id'] },
      { fields: ['user_id'] }
    ]
  });

  return ClubMember;
};
