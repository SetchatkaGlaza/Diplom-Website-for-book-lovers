// routes/adminForum.js
const express = require('express');
const router = express.Router();
const forumModerationController = require('../controllers/forumModerationController');
const { requireAdmin } = require('../middlewares/authMiddleware');

// Все маршруты требуют прав администратора/модератора
router.use(requireAdmin);

// ===== МОДЕРАЦИЯ =====
router.get('/moderation', forumModerationController.getModerationQueue);

// Одобрение/отклонение тем
router.post('/topic/:id/approve', forumModerationController.approveTopic);
router.post('/topic/:id/reject', forumModerationController.rejectTopic);


// Управление темами (для уже одобренных)
router.post('/topic/:id/lock', forumModerationController.toggleTopicLock);
router.post('/topic/:id/pin', forumModerationController.toggleTopicPin);

// ===== УПРАВЛЕНИЕ КАТЕГОРИЯМИ =====
router.get('/categories', forumModerationController.getCategories);
router.post('/categories', forumModerationController.createCategory);
router.post('/categories/:id', forumModerationController.updateCategory);
router.delete('/categories/:id', forumModerationController.deleteCategory);

module.exports = router;