const express = require('express');
const router = express.Router();
const forumModerationController = require('../controllers/forumModerationController');
const { requireAdmin } = require('../middlewares/authMiddleware');

router.use(requireAdmin);

router.get('/', forumModerationController.getDashboard);
router.get('/moderation', forumModerationController.getModerationQueue);
router.get('/topics', forumModerationController.getTopicsManagement);
router.get('/topic/:id/posts', forumModerationController.getTopicPosts);
router.get('/appeals', forumModerationController.getAppeals);

router.post('/topic/:id/approve', forumModerationController.approveTopic);
router.post('/topic/:id/reject', forumModerationController.rejectTopic);
router.post('/post/:id/approve', forumModerationController.approvePost);
router.post('/post/:id/reject', forumModerationController.rejectPost);
router.post('/post/:id/delete', forumModerationController.deleteTopicPost);
router.post('/appeals/:id/resolve', forumModerationController.resolveAppeal);

router.post('/topic/:id/lock', forumModerationController.toggleTopicLock);
router.post('/topic/:id/pin', forumModerationController.toggleTopicPin);

router.get('/categories', forumModerationController.getCategories);
router.post('/categories', forumModerationController.createCategory);
router.post('/categories/:id', forumModerationController.updateCategory);
router.delete('/categories/:id', forumModerationController.deleteCategory);

module.exports = router;
