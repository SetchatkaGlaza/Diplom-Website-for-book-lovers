'use strict';

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Follow = sequelize.define('Follow', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    followerId: { type: DataTypes.INTEGER, allowNull: false },
    followingId: { type: DataTypes.INTEGER, allowNull: false }
  }, {
    tableName: 'follows',
    indexes: [
      { unique: true, fields: ['follower_id', 'following_id'] },
      { fields: ['following_id', 'created_at'] }
    ]
  });

  return Follow;
};
