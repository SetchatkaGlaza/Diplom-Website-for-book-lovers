'use strict';

const { DataTypes } = require('sequelize');

/**
 * Диалог двух людей. Одна пара участников — один диалог,
 * поэтому создание идёт через findOrCreate по нормализованной паре id.
 */
module.exports = (sequelize) => {
  const Conversation = sequelize.define('Conversation', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    // Пара всегда хранится по возрастанию: userAId < userBId, чтобы не было дублей
    userAId: { type: DataTypes.INTEGER, allowNull: false },
    userBId: { type: DataTypes.INTEGER, allowNull: false },
    lastMessageAt: { type: DataTypes.DATE, allowNull: true },
    lastMessagePreview: { type: DataTypes.STRING(160), allowNull: false, defaultValue: '' }
  }, {
    tableName: 'conversations',
    indexes: [
      { unique: true, fields: ['user_a_id', 'user_b_id'] },
      { fields: ['last_message_at'] }
    ]
  });

  return Conversation;
};
