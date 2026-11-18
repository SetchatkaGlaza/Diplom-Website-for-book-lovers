'use strict';

const { DataTypes } = require('sequelize');

/**
 * Журнал писем-дайджестов.
 *
 * Зачем таблица, если есть лог почтового транспорта:
 *  - чтобы не отправить человеку второе письмо о той же неделе (уникальный
 *    индекс по user + kind + period_start);
 *  - чтобы видеть, что рассылка действительно ушла: «кажется, отправили» —
 *    не ответ на вопрос «почему никто не вернулся»;
 *  - чтобы хранить ошибку отправки: адрес мог отвалиться, и это надо знать.
 */
module.exports = (sequelize) => {
  const Digest = sequelize.define('Digest', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    kind: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'weekly' },
    periodStart: { type: DataTypes.DATE, allowNull: true },
    periodEnd: { type: DataTypes.DATE, allowNull: true },
    sentAt: { type: DataTypes.DATE, allowNull: true },
    openedAt: { type: DataTypes.DATE, allowNull: true },
    status: {
      type: DataTypes.ENUM('queued', 'sent', 'failed', 'skipped'),
      allowNull: false,
      defaultValue: 'queued'
    },
    error: { type: DataTypes.TEXT, allowNull: true }
  }, {
    tableName: 'digests',
    indexes: [
      { unique: true, fields: ['user_id', 'kind', 'period_start'] },
      { fields: ['status', 'created_at'] }
    ]
  });

  Digest.KINDS = ['weekly', 'comeback'];
  Digest.STATUSES = ['queued', 'sent', 'failed', 'skipped'];

  return Digest;
};
