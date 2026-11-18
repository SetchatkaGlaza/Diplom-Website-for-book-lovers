'use strict';

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ClubRequest = sequelize.define('ClubRequest', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    clubId: { type: DataTypes.INTEGER, allowNull: false },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    message: { type: DataTypes.STRING(300), allowNull: false, defaultValue: '' },
    // pending → accepted | rejected. Отклонённую можно подать заново.
    state: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'pending' }
  }, {
    tableName: 'club_requests',
    indexes: [
      { fields: ['club_id', 'state'] },
      { fields: ['user_id'] }
    ]
  });

  return ClubRequest;
};
