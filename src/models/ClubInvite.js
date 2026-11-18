'use strict';

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ClubInvite = sequelize.define('ClubInvite', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    clubId: { type: DataTypes.INTEGER, allowNull: false },
    code: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    createdByUserId: { type: DataTypes.INTEGER, allowNull: false },
    maxUses: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    usesCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    expiresAt: { type: DataTypes.DATE, allowNull: true }
  }, {
    tableName: 'club_invites',
    indexes: [{ fields: ['club_id'] }]
  });

  return ClubInvite;
};
