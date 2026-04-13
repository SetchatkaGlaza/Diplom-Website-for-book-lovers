// scripts/optimize-images.js
const path = require('path');
const fs = require('fs-extra');
const imageOptimizer = require('../utils/imageOptimizer');

async function optimizeAllImages() {
  console.log('🚀 НАЧАЛО ОПТИМИЗАЦИИ ИЗОБРАЖЕНИЙ');
  console.log('==================================');

  // Оптимизация аватарок
  console.log('\n📸 ОПТИМИЗАЦИЯ АВАТАРОК:');
  const avatarsDir = path.join(__dirname, '../public/images/avatars');
  if (await fs.pathExists(avatarsDir)) {
    await imageOptimizer.optimizeDirectory(avatarsDir, {
      width: 300,
      height: 300,
      quality: 80
    });
  } else {
    console.log('❌ Директория с аватарками не найдена');
  }

  // Оптимизация обложек книг
  console.log('\n📚 ОПТИМИЗАЦИЯ ОБЛОЖЕК КНИГ:');
  const coversDir = path.join(__dirname, '../public/images/covers');
  if (await fs.pathExists(coversDir)) {
    await imageOptimizer.optimizeDirectory(coversDir, {
      width: 400,
      quality: 85
    });

    // Создаём миниатюры для обложек
    console.log('\n🔍 СОЗДАНИЕ МИНИАТЮР:');
    const files = await fs.readdir(coversDir);
    const imageFiles = files.filter(f => /\.(jpg|jpeg|png)$/i.test(f));

    for (const file of imageFiles) {
      const inputPath = path.join(coversDir, file);
      const thumbPath = path.join(coversDir, file.replace(/\.\w+$/, '-thumb.jpg'));
      
      if (!await fs.pathExists(thumbPath)) {
        await imageOptimizer.optimizeImage(inputPath, thumbPath, {
          width: 150,
          height: 200,
          quality: 70
        });
        console.log(`✅ Миниатюра для ${file}`);
      }
    }
  } else {
    console.log('❌ Директория с обложками не найдена');
  }

  console.log('\n==================================');
  console.log('✅ ОПТИМИЗАЦИЯ ЗАВЕРШЕНА!');
}

// Запускаем оптимизацию
optimizeAllImages().catch(console.error);