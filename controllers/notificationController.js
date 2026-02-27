const notificationService = require('../services/notificationService');

/**
 * Получить уведомления пользователя
 */
exports.getNotifications = async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({ error: 'Не авторизован' });
    }
    
    const userId = req.session.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;
    
    const result = await notificationService.getUserNotifications(userId, limit, offset);
    
    // Для AJAX запросов возвращаем JSON
    if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
      return res.json(result);
    }
    
    // Для обычных запросов рендерим страницу
    res.render('notifications/index', {
      title: 'Уведомления',
      notifications: result.notifications,
      total: result.total,
      unread: result.unread,
      currentPage: page,
      totalPages: Math.ceil(result.total / limit),
      layout: 'layouts/main'
    });
    
  } catch (error) {
    console.error('❌ Ошибка при загрузке уведомлений:', error);
    if (req.xhr) {
      res.status(500).json({ error: 'Ошибка сервера' });
    } else {
      req.flash('error', 'Ошибка при загрузке уведомлений');
      res.redirect('/');
    }
  }
};

/**
 * Получить количество непрочитанных уведомлений
 */
exports.getUnreadCount = async (req, res) => {
  try {
    if (!req.session.user) {
      return res.json({ count: 0 });
    }
    
    const userId = req.session.user.id;
    const count = await notificationService.getUnreadCount(userId);
    
    res.json({ count });
    
  } catch (error) {
    console.error('❌ Ошибка при подсчёте уведомлений:', error);
    res.status(500).json({ error: 'Ошибка сервера', count: 0 });
  }
};

/**
 * Отметить уведомление как прочитанное
 */
exports.markAsRead = async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({ error: 'Не авторизован' });
    }
    
    const userId = req.session.user.id;
    const notificationId = req.params.id;
    
    const success = await notificationService.markAsRead(notificationId, userId);
    
    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Уведомление не найдено' });
    }
    
  } catch (error) {
    console.error('❌ Ошибка при отметке уведомления:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
};

/**
 * Отметить все уведомления как прочитанные
 */
exports.markAllAsRead = async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({ error: 'Не авторизован' });
    }
    
    const userId = req.session.user.id;
    
    await notificationService.markAllAsRead(userId);
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('❌ Ошибка при отметке всех уведомлений:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
};

/**
 * Удалить уведомление
 */
exports.deleteNotification = async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({ error: 'Не авторизован' });
    }
    
    const userId = req.session.user.id;
    const notificationId = req.params.id;
    
    const success = await notificationService.delete(notificationId, userId);
    
    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Уведомление не найдено' });
    }
    
  } catch (error) {
    console.error('❌ Ошибка при удалении уведомления:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
};