// middlewares/imageUpload.js
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const imageOptimizer = require('../utils/imageOptimizer');

// Настройка хранилища для разных типов изображений
const storage = (type) => multer.diskStorage({
  destination: async (req, file, cb) => {
    let uploadPath;
    
    switch (type) {
      case 'avatar':
        uploadPath = path.join(__dirname, '../public/images/avatars');
        break;
      case 'cover':
        uploadPath = path.join(__dirname, '../public/images/covers');
        break;
      default:
        uploadPath = path.join(__dirname, '../uploads');
    }
    
    await fs.ensureDir(uploadPath);
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const prefix = type === 'avatar' ? 'avatar' : 'cover';
    cb(null, `${prefix}-${uniqueSuffix}${ext}`);
  }
});

// Фильтр файлов
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Неподдерживаемый формат. Используйте JPG, PNG, GIF или WebP'), false);
  }
};

// Создаём middleware для загрузки аватарок
const uploadAvatar = multer({
  storage: storage('avatar'),
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 1
  }
}).single('avatar');

// Создаём middleware для загрузки обложек книг
const uploadCover = multer({
  storage: storage('cover'),
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 1
  }
}).single('cover');

// Middleware для оптимизации после загрузки
const optimizeAfterUpload = async (req, res, next) => {
  if (!req.file) {
    return next();
  }

  try {
    const options = {
      quality: 80,
      createWebp: true
    };

    // Для аватарок ещё и ресайзим
    if (req.file.fieldname === 'avatar') {
      options.width = 300;
      options.height = 300;
    }

    // Для обложек книг создаём несколько размеров
    if (req.file.fieldname === 'cover') {
      options.width = 400;
      
      // Также создаём миниатюру
      const thumbPath = req.file.path.replace(/\.\w+$/, '-thumb.jpg');
      await imageOptimizer.optimizeImage(req.file.path, thumbPath, {
        width: 150,
        height: 200,
        quality: 70
      });
    }

    // Оптимизируем основное изображение
    const result = await imageOptimizer.optimizeImage(
      req.file.path,
      req.file.path,
      options
    );

    if (!result.success) {
      console.error('Ошибка при оптимизации изображения');
    }

    next();
  } catch (error) {
    console.error('Ошибка в middleware оптимизации:', error);
    next();
  }
};

// Middleware для обработки ошибок загрузки
const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      req.flash('error', 'Файл слишком большой. Максимальный размер: 5MB');
    } else {
      req.flash('error', 'Ошибка при загрузке файла: ' + err.message);
    }
  } else if (err) {
    req.flash('error', err.message);
  }
  
  res.redirect('back');
};

module.exports = {
  uploadAvatar: (req, res, next) => {
    uploadAvatar(req, res, (err) => {
      if (err) return handleUploadError(err, req, res, next);
      optimizeAfterUpload(req, res, next);
    });
  },
  uploadCover: (req, res, next) => {
    uploadCover(req, res, (err) => {
      if (err) return handleUploadError(err, req, res, next);
      optimizeAfterUpload(req, res, next);
    });
  }
};