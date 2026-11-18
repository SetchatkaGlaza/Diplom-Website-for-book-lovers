'use strict';

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Message = sequelize.define('Message', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    conversationId: { type: DataTypes.INTEGER, allowNull: false },
    senderId: { type: DataTypes.INTEGER, allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: false, validate: { len: [1, 4000] } },
    readAt: { type: DataTypes.DATE, allowNull: true },
    isDeleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
  }, {
    tableName: 'messages',
    indexes: [
      { fields: ['conversation_id', 'created_at'] },
      { fields: ['sender_id'] }
    ]
  });

  return Message;
};
