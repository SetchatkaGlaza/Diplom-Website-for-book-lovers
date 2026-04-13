// routes/forum.js
const express = require('express');
const router = express.Router();
const forumController = require('../controllers/forumController');
const { requireAuth } = require('../middlewares/authMiddleware');

// ===== ПУБЛИЧНЫЕ МАРШРУТЫ (доступны всем) =====
router.get('/', forumController.getIndex);
router.get('/category/:id', forumController.getCategory);
router.get('/topic/:id', forumController.getTopic);
router.get('/search', forumController.search);

// ===== МАРШРУТЫ, ТРЕБУЮЩИЕ АВТОРИЗАЦИИ =====
router.get('/new', requireAuth, forumController.getNewTopic);
router.post('/new', requireAuth, forumController.postNewTopic);
router.post('/topic/:id/reply', requireAuth, forumController.postReply);
router.post('/post/:id/like', requireAuth, forumController.likePost);
router.post('/topic/:id/subscribe', requireAuth, forumController.toggleSubscription);
router.get('/post-moderation/:id/appeal', requireAuth, forumController.getPostAppealForm);
router.post('/post-moderation/:id/appeal', requireAuth, forumController.postPostAppealForm);

module.exports = router;
