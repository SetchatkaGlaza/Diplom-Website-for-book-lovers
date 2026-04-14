const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { requireAdmin, requireSuperAdmin } = require('../middlewares/authMiddleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const importController = require('../controllers/importController');
const imageValidator = require('../middlewares/imageValidator');

// ===== НАСТРОЙКА ДЛЯ ОБЛОЖЕК (картинки) =====
const coverStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = 'public/images/covers';
    // Создаём папку, если её нет
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'cover-' + uniqueSuffix + ext);
  }
});

const coverFileFilter = (req, file, cb) => {
  // Только изображения
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const allowedExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();
  
  if (allowedTypes.includes(file.mimetype) || allowedExt.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Неподдерживаемый формат изображения. Используйте JPG, PNG, GIF или WEBP'), false);
  }
};

const uploadCover = multer({
  storage: coverStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB для картинок
  fileFilter: coverFileFilter
});

// ===== НАСТРОЙКА ДЛЯ ИМПОРТА (CSV/JSON) =====
const importStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = 'uploads';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const timestamp = Date.now();
    const originalName = file.originalname;
    cb(null, `import-${timestamp}-${originalName}`);
  }
});

const importFileFilter = (req, file, cb) => {
  const allowedExtensions = ['.csv', '.json', '.txt'];
  const ext = path.extname(file.originalname).toLowerCase();
  
  console.log('📁 Загружаемый файл:', file.originalname, 'Расширение:', ext);
  
  if (allowedExtensions.includes(ext)) {
    console.log('✅ Расширение разрешено для импорта');
    cb(null, true);
  } else {
    console.log('❌ Неподдерживаемое расширение для импорта:', ext);
    cb(new Error('Неподдерживаемый тип файла. Используйте CSV или JSON'), false);
  }
};

const uploadImport = multer({
  storage: importStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB для файлов
  fileFilter: importFileFilter
});

// ===== МАРШРУТЫ =====

// Дашборд
router.get('/', requireAdmin, adminController.getDashboard);


// ===== УПРАВЛЕНИЕ КНИГАМИ =====
router.get('/books', requireAdmin, adminController.getBooks);
router.get('/books/add', requireAdmin, adminController.getAddBook);
router.post(
  '/books/add',
  requireAdmin,
  uploadCover.single('cover'),
  imageValidator.validateBookCover,
  imageValidator.autoCropBookCover,
  adminController.postAddBook
);
router.get('/books/:id/edit', requireAdmin, adminController.getEditBook);
router.post(
  '/books/:id/edit',
  requireAdmin,
  uploadCover.single('cover'),
  imageValidator.validateBookCover,
  imageValidator.autoCropBookCover,
  adminController.postEditBook
);
router.delete('/books/:id', requireAdmin, adminController.deleteBook);

// ===== ИМПОРТ КНИГ =====
router.get('/import/example-genres', requireAdmin, importController.downloadExampleWithGenres);
router.get('/import', requireAdmin, importController.getImportPage);
router.post('/import', requireAdmin, uploadImport.single('file'), (err, req, res, next) => {
  // Обработка ошибок multer
  if (err) {
    console.error('❌ Ошибка при загрузке файла:', err);
    req.flash('error', err.message || 'Ошибка при загрузке файла');
    return res.redirect('/admin/import');
  }
  next();
}, importController.importBooks);

router.get('/import/result', requireAdmin, importController.showImportResult);
router.get('/import/template', requireAdmin, importController.downloadTemplate);

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
