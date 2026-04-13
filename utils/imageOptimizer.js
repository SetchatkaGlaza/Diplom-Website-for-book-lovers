// utils/imageOptimizer.js
const sharp = require('sharp');
const fs = require('fs-extra');
const path = require('path');
const imagemin = require('imagemin');
const imageminMozjpeg = require('imagemin-mozjpeg');
const imageminPngquant = require('imagemin-pngquant');
const imageminGifsicle = require('imagemin-gifsicle');
const imageminWebp = require('imagemin-webp');

class ImageOptimizer {
  constructor() {
    this.uploadDirs = {
      avatars: path.join(__dirname, '../public/images/avatars'),
      covers: path.join(__dirname, '../public/images/covers'),
      temp: path.join(__dirname, '../uploads')
    };
    
    // Создаём директории, если их нет
    Object.values(this.uploadDirs).forEach(dir => {
      fs.ensureDirSync(dir);
    });
  }

  /**
   * Оптимизация одного изображения
   * @param {string} inputPath - путь к исходному файлу
   * @param {string} outputPath - путь для сохранения
   * @param {Object} options - настройки оптимизации
   */
  async optimizeImage(inputPath, outputPath, options = {}) {
    try {
      const ext = path.extname(inputPath).toLowerCase();
      const defaultOptions = {
        quality: 80,
        width: options.width || null,
        height: options.height || null,
        fit: 'cover'
      };

      let result;

      // Обработка разных форматов
      switch (ext) {
        case '.jpg':
        case '.jpeg':
          result = await this.optimizeJPEG(inputPath, outputPath, defaultOptions);
          break;
        case '.png':
          result = await this.optimizePNG(inputPath, outputPath, defaultOptions);
          break;
        case '.gif':
          result = await this.optimizeGIF(inputPath, outputPath, defaultOptions);
          break;
        case '.webp':
          result = await this.optimizeWebP(inputPath, outputPath, defaultOptions);
          break;
        default:
          // Просто копируем неподдерживаемые форматы
          await fs.copy(inputPath, outputPath);
          result = { success: true, format: ext };
      }

      // Создаём WebP версию для современных браузеров
      if (options.createWebp !== false && ext !== '.webp') {
        await this.createWebpVersion(outputPath);
      }

      console.log(`✅ Оптимизировано: ${path.basename(inputPath)}`);
      return { success: true, path: outputPath };
    } catch (error) {
      console.error(`❌ Ошибка при оптимизации ${inputPath}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Оптимизация JPEG
   */
  async optimizeJPEG(inputPath, outputPath, options) {
    let pipeline = sharp(inputPath);

    if (options.width || options.height) {
      pipeline = pipeline.resize(options.width, options.height, {
        fit: options.fit,
        withoutEnlargement: true
      });
    }

    await pipeline
      .jpeg({ quality: options.quality, mozjpeg: true })
      .toFile(outputPath);

    return { success: true, format: 'jpeg' };
  }

  /**
   * Оптимизация PNG
   */
  async optimizePNG(inputPath, outputPath, options) {
    let pipeline = sharp(inputPath);

    if (options.width || options.height) {
      pipeline = pipeline.resize(options.width, options.height, {
        fit: options.fit,
        withoutEnlargement: true
      });
    }

    await pipeline
      .png({ quality: options.quality, compressionLevel: 9 })
      .toFile(outputPath);

    return { success: true, format: 'png' };
  }

  /**
   * Оптимизация GIF
   */
  async optimizeGIF(inputPath, outputPath, options) {
    // Для GIF используем imagemin
    const files = await imagemin([inputPath], {
      destination: path.dirname(outputPath),
      plugins: [
        imageminGifsicle({
          optimizationLevel: 3,
          colors: options.colors || 256
        })
      ]
    });

    return { success: true, format: 'gif' };
  }

  /**
   * Оптимизация WebP
   */
  async optimizeWebP(inputPath, outputPath, options) {
    let pipeline = sharp(inputPath);

    if (options.width || options.height) {
      pipeline = pipeline.resize(options.width, options.height, {
        fit: options.fit,
        withoutEnlargement: true
      });
    }

    await pipeline
      .webp({ quality: options.quality })
      .toFile(outputPath);

    return { success: true, format: 'webp' };
  }

  /**
   * Создание WebP версии изображения
   */
  async createWebpVersion(imagePath) {
    try {
      const webpPath = imagePath.replace(/\.(jpg|jpeg|png|gif)$/i, '.webp');
      
      await sharp(imagePath)
        .webp({ quality: 75 })
        .toFile(webpPath);

      return webpPath;
    } catch (error) {
      console.error('Ошибка при создании WebP:', error);
      return null;
    }
  }

  /**
   * Пакетная оптимизация всех изображений в директории
   */
  async optimizeDirectory(directory, options = {}) {
    try {
      const files = await fs.readdir(directory);
      const imageFiles = files.filter(file => 
        /\.(jpg|jpeg|png|gif|webp)$/i.test(file)
      );

      console.log(`🔄 Найдено ${imageFiles.length} изображений для оптимизации...`);

      let optimized = 0;
      let errors = 0;

      for (const file of imageFiles) {
        const inputPath = path.join(directory, file);
        const outputPath = path.join(directory, `optimized-${file}`);

        try {
          const result = await this.optimizeImage(inputPath, outputPath, options);
          if (result.success) {
            // Заменяем оригинал оптимизированной версией
            await fs.move(outputPath, inputPath, { overwrite: true });
            optimized++;
          } else {
            errors++;
          }
        } catch (error) {
          console.error(`Ошибка при обработке ${file}:`, error);
          errors++;
        }
      }

      console.log(`✅ Оптимизировано: ${optimized}, ошибок: ${errors}`);
      return { optimized, errors };
    } catch (error) {
      console.error('Ошибка при оптимизации директории:', error);
      return { optimized: 0, errors: 0 };
    }
  }

  /**
   * Генерация нескольких размеров для адаптивных изображений
   */
  async generateResponsiveImages(inputPath, outputDir, baseName, sizes = [300, 600, 900]) {
    try {
      const results = [];

      for (const size of sizes) {
        const outputPath = path.join(outputDir, `${baseName}-${size}.jpg`);
        
        await sharp(inputPath)
          .resize(size, null, { withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toFile(outputPath);

        results.push({ size, path: outputPath });
      }

      return results;
    } catch (error) {
      console.error('Ошибка при генерации адаптивных изображений:', error);
      return [];
    }
  }

  /**
   * Получение оптимального формата для браузера
   */
  getOptimalImagePath(basePath, req) {
    const acceptsWebp = req && req.headers.accept && req.headers.accept.includes('image/webp');
    
    if (acceptsWebp) {
      const webpPath = basePath.replace(/\.(jpg|jpeg|png)$/i, '.webp');
      if (fs.existsSync(path.join(__dirname, '../public', webpPath))) {
        return webpPath;
      }
    }
    
    return basePath;
  }
}

module.exports = new ImageOptimizer();