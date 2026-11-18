'use strict';

const { DataTypes } = require('sequelize');

/**
 * Журнал действий модерации. Отдельная таблица, а не activities:
 * журнал нельзя перемешивать с читательской лентой, и он должен жить
 * даже если пользователь удалил аккаунт (поэтому set null, не cascade).
 */
module.exports = (sequelize) => {
  const ModerationLog = sequelize.define('ModerationLog', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    actorId: { type: DataTypes.INTEGER, allowNull: true },
    action: { type: DataTypes.STRING(60), allowNull: false },
    subjectType: { type: DataTypes.STRING(30), allowNull: true },
    subjectId: { type: DataTypes.INTEGER, allowNull: true },
    note: { type: DataTypes.STRING(500), allowNull: false, defaultValue: '' },
    meta: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
  }, {
    tableName: 'moderation_log',
    indexes: [
      { fields: ['created_at'] },
      { fields: ['subject_type', 'subject_id'] }
    ]
  });

  return ModerationLog;
};
