const sharp = require('sharp');
const path = require('path');
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
    const filePath = req.file.path;
    const metadata = await sharp(filePath).metadata();
    
    const { width, height } = metadata;
    if (!width || !height) {
      fs.unlinkSync(filePath);
      req.flash('error', 'Не удалось определить размеры изображения.');
      return res.redirect('back');
    }

    next();
    
  } catch (error) {
    console.error('❌ Ошибка при валидации изображения:', error);
    
    // Удаляем проблемный файл
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {}
    }
    
    req.flash('error', 'Ошибка при обработке изображения. Файл может быть повреждён.');
    res.redirect('back');
  }
};

/**
 * Автоматическая обрезка обложки под 2:3 и стандартный размер
 */
exports.autoCropBookCover = async (req, res, next) => {
  if (!req.file) return next();
  
  try {
    const filePath = req.file.path;
    const parsedPath = path.parse(filePath);
    const outputPath = path.join(parsedPath.dir, `cropped-${parsedPath.base}`);
    
    // Обрезаем/масштабируем до пропорций 2:3
    await sharp(filePath)
      .resize(600, 900, {
        fit: 'cover',
        position: 'center'
      })
      .toFile(outputPath);
    
    // Заменяем оригинал обрезанным
    fs.unlinkSync(filePath);
    fs.renameSync(outputPath, filePath);
    
    console.log('✅ Изображение обрезано до 600x900');
    next();
    
  } catch (error) {
    console.error('❌ Ошибка при обрезке изображения:', error);
    next();
  }
};
