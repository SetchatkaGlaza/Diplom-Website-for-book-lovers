const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const { requireAuth } = require('../middlewares/authMiddleware');

router.get('/new/:bookId', requireAuth, reviewController.getNewReview);
router.post('/new/:bookId', requireAuth, reviewController.postNewReview);

router.get('/:id/edit', requireAuth, reviewController.getEditReview);
router.post('/:id/edit', requireAuth, reviewController.postEditReview);

router.delete('/:id', requireAuth, reviewController.deleteReview);

router.post('/:id/rate', requireAuth, reviewController.rateReview);

module.exports = router;
