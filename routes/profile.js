const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');
const { requireAuth } = require('../middlewares/authMiddleware');
const multer = require('multer');
const path = require('path');

// Настройка multer для загрузки аватарок
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/images/avatars/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'avatar-' + uniqueSuffix + ext);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Неподдерживаемый формат файла'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: fileFilter
});

// Все маршруты профиля защищены requireAuth

// Главная профиля
router.get('/', requireAuth, profileController.getProfile);

// Редактирование профиля
router.get('/edit', requireAuth, profileController.getEditProfile);
router.post('/edit', requireAuth, profileController.postEditProfile);

// Загрузка аватарки
router.post('/avatar', requireAuth, upload.single('avatar'), profileController.uploadAvatar);

// Смена пароля
router.post('/change-password', requireAuth, profileController.postChangePassword);

// Мои книги (полки)
router.get('/books', requireAuth, profileController.getMyBooks);

// Обновление статуса книги (AJAX)
router.post('/books/status', requireAuth, profileController.updateBookStatus);

// Удаление книги с полки
router.delete('/books/:bookId', requireAuth, profileController.removeBookFromShelf);

// Мои рецензии
router.get('/reviews', requireAuth, profileController.getMyReviews);

// Редактирование рецензии
router.get('/reviews/:reviewId/edit', requireAuth, profileController.getEditReview);
router.post('/reviews/:reviewId/edit', requireAuth, profileController.postEditReview);

// Удаление рецензии
router.delete('/reviews/:reviewId', requireAuth, profileController.deleteReview);

// Публичный профиль (доступен всем)
router.get('/:userId', profileController.getPublicProfile);

module.exports = router;