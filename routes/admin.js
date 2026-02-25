const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { requireAdmin, requireSuperAdmin } = require('../middlewares/authMiddleware');
const multer = require('multer');
const path = require('path');

// Настройка multer для загрузки обложек книг
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/images/covers/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'cover-' + uniqueSuffix + ext);
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

// 📌 Все маршруты админки защищены requireAdmin

// Дашборд
router.get('/', requireAdmin, adminController.getDashboard);

// ===== УПРАВЛЕНИЕ КНИГАМИ =====
router.get('/books', requireAdmin, adminController.getBooks);
router.get('/books/add', requireAdmin, adminController.getAddBook);
router.post('/books/add', requireAdmin, upload.single('cover'), adminController.postAddBook);
router.get('/books/:id/edit', requireAdmin, adminController.getEditBook);
router.post('/books/:id/edit', requireAdmin, upload.single('cover'), adminController.postEditBook);
router.delete('/books/:id', requireAdmin, adminController.deleteBook);

// ===== УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ =====
router.get('/users', requireAdmin, adminController.getUsers);
router.post('/users/:id/role', requireSuperAdmin, adminController.updateUserRole);
router.post('/users/:id/toggle-block', requireAdmin, adminController.toggleUserBlock);

// ===== УПРАВЛЕНИЕ ЖАНРАМИ =====
router.get('/genres', requireAdmin, adminController.getGenres);
router.post('/genres/add', requireAdmin, adminController.addGenre);
router.post('/genres/:id/edit', requireAdmin, adminController.editGenre);
router.delete('/genres/:id', requireAdmin, adminController.deleteGenre);

// ===== МОДЕРАЦИЯ РЕЦЕНЗИЙ =====
router.get('/reviews', requireAdmin, adminController.getReviews);
router.post('/reviews/:id/approve', requireAdmin, adminController.approveReview);
router.delete('/reviews/:id', requireAdmin, adminController.deleteReview);

// ===== СТАТИСТИКА =====
router.get('/statistics', requireAdmin, adminController.getStatistics);

module.exports = router;