const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { requireAuth } = require('../middlewares/authMiddleware');

// Все маршруты уведомлений требуют авторизации
router.use(requireAuth);

// Получить все уведомления
router.get('/', notificationController.getNotifications);

// Получить количество непрочитанных
router.get('/unread-count', notificationController.getUnreadCount);

// Отметить как прочитанное
router.post('/:id/read', notificationController.markAsRead);

// Отметить все как прочитанные
router.post('/mark-all-read', notificationController.markAllAsRead);

// Удалить уведомление
router.delete('/:id', notificationController.deleteNotification);

module.exports = router;