const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { requireAdmin, requireSuperAdmin } = require('../middlewares/authMiddleware');
const multer = require('multer');
const path = require('path');
const importController = require('../controllers/importController');
const imageValidator = require('../middlewares/imageValidator');
const { MB, createDiskStorage, ensureDirectory, imageFileFilter } = require('../utils/uploadConfig');
const COVER_DIR = 'public/images/covers';
const IMPORT_DIR = 'uploads';

const coverStorage = createDiskStorage({
  destinationDir: COVER_DIR,
  filenamePrefix: 'cover'
});

const uploadCover = multer({
  storage: coverStorage,
  limits: { fileSize: 5 * MB },
  fileFilter: imageFileFilter
});

const importStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    ensureDirectory(IMPORT_DIR);
    cb(null, IMPORT_DIR);
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

  if (allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Неподдерживаемый тип файла. Используйте CSV, JSON или TXT'), false);
  }
};

const uploadImport = multer({
  storage: importStorage,
  limits: { fileSize: 10 * MB },
  fileFilter: importFileFilter
});

router.get('/', requireAdmin, adminController.getDashboard);

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

router.get('/import/example-genres', requireAdmin, importController.downloadExampleWithGenres);
router.get('/import', requireAdmin, importController.getImportPage);
router.post('/import', requireAdmin, uploadImport.single('file'), (err, req, res, next) => {
  if (err) {
    console.error('❌ Ошибка при загрузке файла:', err);
    req.flash('error', err.message || 'Ошибка при загрузке файла');
    return res.redirect('/admin/import');
  }
  next();
}, importController.importBooks);

router.get('/import/result', requireAdmin, importController.showImportResult);
router.get('/import/template', requireAdmin, importController.downloadTemplate);

router.get('/users', requireAdmin, adminController.getUsers);
router.post('/users/:id/role', requireSuperAdmin, adminController.updateUserRole);
router.post('/users/:id/toggle-block', requireAdmin, adminController.toggleUserBlock);

router.get('/genres', requireAdmin, adminController.getGenres);
router.post('/genres/add', requireAdmin, adminController.addGenre);
router.post('/genres/:id/edit', requireAdmin, adminController.editGenre);
router.delete('/genres/:id', requireAdmin, adminController.deleteGenre);

router.get('/reviews', requireAdmin, adminController.getReviews);
router.post('/reviews/:id/approve', requireAdmin, adminController.approveReview);
router.delete('/reviews/:id', requireAdmin, adminController.deleteReview);

router.get('/statistics', requireAdmin, adminController.getStatistics);

module.exports = router;
