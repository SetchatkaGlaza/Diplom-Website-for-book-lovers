'use strict';

const { DataTypes } = require('sequelize');

/**
 * Одноразовые токены: подтверждение почты и сброс пароля.
 *
 * В базе хранится только SHA-256 от токена. Если база утечёт, по хешу
 * нельзя воспользоваться ссылкой из письма — это ровно та ошибка, из-за
 * которой у многих проектов уводят аккаунты.
 */
module.exports = (sequelize) => {
  const Token = sequelize.define('Token', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    type: {
      type: DataTypes.ENUM('verify_email', 'reset_password'),
      allowNull: false
    },
    tokenHash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    usedAt: { type: DataTypes.DATE, allowNull: true }
  }, {
    tableName: 'user_tokens',
    indexes: [
      { fields: ['user_id', 'type'] },
      { fields: ['expires_at'] }
    ]
  });

  Token.TYPES = ['verify_email', 'reset_password'];

  return Token;
};
