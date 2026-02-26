const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const { requireAuth } = require('../middlewares/authMiddleware');

// Все маршруты рецензий требуют авторизации

// Новая рецензия
router.get('/new/:bookId', requireAuth, reviewController.getNewReview);
router.post('/new/:bookId', requireAuth, reviewController.postNewReview);

// Редактирование рецензии
router.get('/:id/edit', requireAuth, reviewController.getEditReview);
router.post('/:id/edit', requireAuth, reviewController.postEditReview);

// Удаление рецензии
router.delete('/:id', requireAuth, reviewController.deleteReview);

// Оценка полезности рецензии (AJAX)
router.post('/:id/rate', requireAuth, reviewController.rateReview);

module.exports = router;