'use strict';

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ClubSchedule = sequelize.define('ClubSchedule', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    clubId: { type: DataTypes.INTEGER, allowNull: false },
    chapter: { type: DataTypes.INTEGER, allowNull: false },
    discussionOn: { type: DataTypes.DATEONLY, allowNull: false },
    note: { type: DataTypes.STRING(300), allowNull: false, defaultValue: '' }
  }, {
    tableName: 'club_schedule',
    indexes: [{ unique: true, fields: ['club_id', 'chapter'] }]
  });

  return ClubSchedule;
};
