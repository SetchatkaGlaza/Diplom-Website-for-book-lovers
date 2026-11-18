'use strict';

const { Notification } = require('../models');

async function push(userId, { type, title, body = '', url = null }) {
  if (!userId) return null;
  try {
    return await Notification.create({ userId, type, title, body, url });
  } catch (error) {
    console.error('[notifications] не удалось создать уведомление:', error.message);
    return null;
  }
}

async function unreadCount(userId) {
  if (!userId) return 0;
  return Notification.count({ where: { userId, isRead: false } });
}

async function list(userId, limit = 20) {
  return Notification.findAll({
    where: { userId },
    order: [['createdAt', 'DESC']],
    limit
  });
}

async function markAllRead(userId) {
  await Notification.update({ isRead: true }, { where: { userId, isRead: false } });
}

module.exports = { push, unreadCount, list, markAllRead };
