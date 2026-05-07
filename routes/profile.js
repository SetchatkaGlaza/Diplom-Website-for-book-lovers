const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');
const { requireAuth } = require('../middlewares/authMiddleware');
const multer = require('multer');
const { MB, createMemoryStorage, imageFileFilter } = require('../utils/uploadConfig');

// Переключаемся с diskStorage на memoryStorage для Cloudinary
const storage = createMemoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 5 * MB },
  fileFilter: imageFileFilter
});

const handleAvatarUpload = (req, res, next) => {
  upload.single('avatar')(req, res, (error) => {
    if (!error) {
      return next();
    }

    if (error instanceof multer.MulterError) {
      const message = error.code === 'LIMIT_FILE_SIZE'
        ? 'Файл слишком большой. Максимальный размер аватара — 5MB.'
        : `Ошибка загрузки изображения: ${error.message}`;
      req.flash('error', message);
      return res.redirect('/profile/edit');
    }

    req.flash('error', error.message || 'Не удалось загрузить изображение. Проверьте формат файла.');
    return res.redirect('/profile/edit');
  });
};

router.get('/', requireAuth, profileController.getProfile);

router.get('/edit', requireAuth, profileController.getEditProfile);
router.post('/edit', requireAuth, profileController.postEditProfile);

router.post('/avatar', requireAuth, handleAvatarUpload, profileController.uploadAvatar);

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