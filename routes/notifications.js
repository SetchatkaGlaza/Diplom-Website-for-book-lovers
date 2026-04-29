const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { requireAuth } = require('../middlewares/authMiddleware');

router.use(requireAuth);

router.get('/', notificationController.getNotifications);

router.get('/unread-count', notificationController.getUnreadCount);

router.post('/:id/read', notificationController.markAsRead);

router.post('/mark-all-read', notificationController.markAllAsRead);

router.delete('/:id', notificationController.deleteNotification);

module.exports = router;
