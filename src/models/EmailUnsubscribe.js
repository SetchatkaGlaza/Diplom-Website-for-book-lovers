'use strict';

const { DataTypes } = require('sequelize');

/**
 * Отписка от писем по ссылке из письма.
 *
 * Хранится хеш адреса, а не id человека: отписаться можно, не входя в
 * аккаунт, а по ссылке нельзя перебрать чужие адреса. Хеш — SHA-256 от
 * нормализованного (trim + lower) e-mail без секрета: ссылка должна
 * работать и после смены SESSION_SECRET, иначе отписки «отвалятся».
 */
module.exports = (sequelize) => {
  const EmailUnsubscribe = sequelize.define('EmailUnsubscribe', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    emailHash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    kind: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'all' },
    reason: { type: DataTypes.STRING(200), allowNull: false, defaultValue: '' }
  }, {
    tableName: 'email_unsubscribes',
    indexes: [{ fields: ['email_hash'], unique: true }]
  });

  return EmailUnsubscribe;
};
