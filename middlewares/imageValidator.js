const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

/**
 * Валидация изображения для обложки книги
 * Требования:
 * - Минимальная ширина: 200px
 * - Минимальная высота: 300px
 * - Максимальная ширина: 1000px
 * - Максимальная высота: 1500px
 * - Соотношение сторон: примерно 2:3 (допуск ±0.2)
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
    const aspectRatio = width / height;
    const expectedRatio = 2 / 3; // 0.666...
    const ratioDiff = Math.abs(aspectRatio - expectedRatio);
    
    console.log('📸 Проверка изображения:', {
      width,
      height,
      aspectRatio: aspectRatio.toFixed(3),
      ratioDiff: ratioDiff.toFixed(3)
    });
    
    const errors = [];
    
    // Проверка минимальных размеров
    if (width < 200) {
      errors.push(`Ширина изображения слишком мала (${width}px). Минимум 200px.`);
    }
    
    if (height < 300) {
      errors.push(`Высота изображения слишком мала (${height}px). Минимум 300px.`);
    }
    
    // Проверка максимальных размеров
    if (width > 1000) {
      errors.push(`Ширина изображения слишком велика (${width}px). Максимум 1000px.`);
    }
    
    if (height > 1500) {
      errors.push(`Высота изображения слишком велика (${height}px). Максимум 1500px.`);
    }
    
    // Проверка соотношения сторон (допустимое отклонение 0.2)
    if (ratioDiff > 0.2) {
      errors.push(`Неподходящее соотношение сторон (${aspectRatio.toFixed(2)}). Ожидается примерно 2:3 (0.67).`);
    }
    
    // Если есть ошибки, удаляем загруженный файл и возвращаем ошибку
    if (errors.length > 0) {
      // Удаляем файл
      fs.unlinkSync(filePath);
      
      req.flash('error', errors.join(' '));
      return res.redirect('back');
    }
    
    // Всё хорошо - идём дальше
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
 * Автоматическая обрезка изображения под стандартный размер
 * (опционально - может пригодиться позже)
 */
exports.autoCropBookCover = async (req, res, next) => {
  if (!req.file) return next();
  
  try {
    const filePath = req.file.path;
    const parsedPath = path.parse(filePath);
    const outputPath = path.join(parsedPath.dir, `cropped-${parsedPath.base}`);
    
    // Обрезаем до пропорций 2:3 и уменьшаем до стандартного размера
    await sharp(filePath)
      .resize(300, 450, {
        fit: 'cover',
        position: 'center'
      })
      .toFile(outputPath);
    
    // Заменяем оригинал обрезанным
    fs.unlinkSync(filePath);
    fs.renameSync(outputPath, filePath);
    
    console.log('✅ Изображение обрезано до 300x450');
    next();
    
  } catch (error) {
    console.error('❌ Ошибка при обрезке изображения:', error);
    next();
  }
};