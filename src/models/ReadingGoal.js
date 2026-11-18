'use strict';

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ReadingGoal = sequelize.define('ReadingGoal', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    year: { type: DataTypes.INTEGER, allowNull: false },
    targetBooks: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 12 }
  }, {
    tableName: 'reading_goals',
    indexes: [{ unique: true, fields: ['user_id', 'year'] }]
  });

  return ReadingGoal;
};
