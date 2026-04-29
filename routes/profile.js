const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');
const { requireAuth } = require('../middlewares/authMiddleware');
const multer = require('multer');
const { MB, createDiskStorage, imageFileFilter } = require('../utils/uploadConfig');

const storage = createDiskStorage({
  destinationDir: 'public/images/avatars/',
  filenamePrefix: 'avatar'
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * MB },
  fileFilter: imageFileFilter
});

router.get('/', requireAuth, profileController.getProfile);

router.get('/edit', requireAuth, profileController.getEditProfile);
router.post('/edit', requireAuth, profileController.postEditProfile);

router.post('/avatar', requireAuth, upload.single('avatar'), profileController.uploadAvatar);

router.post('/change-password', requireAuth, profileController.postChangePassword);

router.get('/books', requireAuth, profileController.getMyBooks);

router.post('/books/status', requireAuth, profileController.updateBookStatus);

router.delete('/books/:bookId', requireAuth, profileController.removeBookFromShelf);

router.get('/reviews', requireAuth, profileController.getMyReviews);

router.get('/reviews/:reviewId/edit', requireAuth, profileController.getEditReview);
router.post('/reviews/:reviewId/edit', requireAuth, profileController.postEditReview);

router.delete('/reviews/:reviewId', requireAuth, profileController.deleteReview);

router.get('/:userId', profileController.getPublicProfile);

module.exports = router;
