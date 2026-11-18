'use strict';

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Report = sequelize.define('Report', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    reporterId: { type: DataTypes.INTEGER, allowNull: false },
    subjectType: {
      type: DataTypes.ENUM('review', 'comment', 'club_post', 'user'),
      allowNull: false
    },
    subjectId: { type: DataTypes.INTEGER, allowNull: false },
    reason: { type: DataTypes.STRING(500), allowNull: false },
    state: {
      type: DataTypes.ENUM('open', 'resolved', 'rejected'),
      allowNull: false,
      defaultValue: 'open'
    },
    resolvedByUserId: { type: DataTypes.INTEGER, allowNull: true },
    resolutionNote: { type: DataTypes.STRING(500), allowNull: true }
  }, {
    tableName: 'reports',
    indexes: [
      { fields: ['state', 'created_at'] },
      { fields: ['subject_type', 'subject_id'] }
    ]
  });

  return Report;
};
