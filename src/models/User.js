'use strict';

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const User = sequelize.define('User', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(60), allowNull: false },
    email: { type: DataTypes.STRING(254), allowNull: false, unique: true },
    passwordHash: { type: DataTypes.STRING(120), allowNull: false },
    role: {
      type: DataTypes.ENUM('user', 'moderator', 'editor', 'admin'),
      allowNull: false,
      defaultValue: 'user'
    },
    bio: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    avatar: { type: DataTypes.STRING(255), allowNull: false, defaultValue: 'default-avatar.svg' },
    trustLevel: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    isBlocked: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    blockedUntil: { type: DataTypes.DATE, allowNull: true },
    sessionEpoch: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    emailVerifiedAt: { type: DataTypes.DATE, allowNull: true },
    lastActiveAt: { type: DataTypes.DATE, allowNull: true },
    registrationIp: { type: DataTypes.STRING(45), allowNull: true },
    // Заполняется при удалении аккаунта: строка остаётся, но обезличена
    deletedAt: { type: DataTypes.DATE, allowNull: true },
    // Приватный профиль: полку видят только подписчики
    isPrivate: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    // По каким событиям присылать уведомления в интерфейсе
    notifyFollows: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    notifyComments: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    notifyLikes: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    notifyMessages: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    // Письма-дайджесты: по умолчанию выключены. Рассылка «по умолчанию» —
    // это спам, даже если письмо полезное; согласие должно быть действием.
    notifyDigest: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
  }, {
    tableName: 'users',
    indexes: [
      { fields: ['role'] },
      { fields: ['last_active_at'] }
    ]
  });

  User.prototype.toPublicJSON = function toPublicJSON() {
    return {
      id: this.id,
      name: this.name,
      avatar: this.avatar,
      bio: this.bio,
      role: this.role,
      trustLevel: this.trustLevel,
      createdAt: this.createdAt
    };
  };

  return User;
};
