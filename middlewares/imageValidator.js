const sharp = require('sharp');
const fs = require('fs');

/**
 * Валидация изображения для обложки книги
 * Базовая проверка:
 * - Файл реально является изображением
 * - Изображение можно прочитать
 */
exports.validateBookCover = async (req, res, next) => {
  // Если файл не загружен, пропускаем (значит оставляем старую обложку)
  if (!req.file) {
    return next();
  }

  try {
    const imageInput = req.file.buffer || req.file.path;
    const metadata = await sharp(imageInput).metadata();
    
    const { width, height } = metadata;
    if (!width || !height) {
      if (req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      req.flash('error', 'Не удалось определить размеры изображения.');
      return res.redirect(req.get('referer') || '/admin/books');
    }

    next();
    
  } catch (error) {
    console.error('❌ Ошибка при валидации изображения:', error);
    
    // Удаляем проблемный файл
    if (req.file && req.file.path) {
      try {
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
      } catch (e) {}
    }
    
    req.flash('error', 'Ошибка при обработке изображения. Файл может быть повреждён.');
    res.redirect(req.get('referer') || '/admin/books');
  }
};

/**
 * Автоматическая обрезка обложки под 2:3 и стандартный размер
 */
exports.autoCropBookCover = async (req, res, next) => {
  if (!req.file) return next();
  
  try {
    const imageInput = req.file.buffer || req.file.path;
    const croppedBuffer = await sharp(imageInput)
      .resize(600, 900, {
        fit: 'cover',
        position: 'center'
      })
      .jpeg({ quality: 88 })
      .toBuffer();

    // Для memoryStorage подменяем буфер, для diskStorage перезаписываем файл
    if (req.file.buffer) {
      req.file.buffer = croppedBuffer;
      req.file.size = croppedBuffer.length;
      req.file.mimetype = 'image/jpeg';
    } else if (req.file.path) {
      fs.writeFileSync(req.file.path, croppedBuffer);
      req.file.size = croppedBuffer.length;
      req.file.mimetype = 'image/jpeg';
    }
    
    console.log('✅ Изображение обрезано до 600x900');
    next();
    
  } catch (error) {
    console.error('❌ Ошибка при обрезке изображения:', error);
    next();
  }
};
