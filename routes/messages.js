// routes/messages.js
const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');
const { requireAuth, requireAdmin } = require('../middlewares/authMiddleware');

// ===== ПУБЛИЧНЫЙ МАРШРУТ (для формы обратной связи) =====
router.post('/send', messageController.sendMessage);

// ===== ЗАЩИЩЁННЫЕ МАРШРУТЫ (только для админов) =====
router.get('/admin/messages', requireAdmin, messageController.getAllMessages);
router.get('/admin/messages/stats', requireAdmin, messageController.getMessageStats);
router.get('/admin/messages/:id', requireAdmin, messageController.getMessageById);
router.post('/admin/messages/:id/reply', requireAdmin, messageController.replyToMessage);
router.post('/admin/messages/:id/archive', requireAdmin, messageController.archiveMessage);
router.post('/admin/messages/:id/restore', requireAdmin, messageController.restoreMessage);
router.post('/admin/messages/:id/note', requireAdmin, messageController.addNote);
router.delete('/admin/messages/:id', requireAdmin, messageController.deleteMessage);

module.exports = router;