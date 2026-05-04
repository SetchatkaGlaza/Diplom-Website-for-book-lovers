const cloudinary = require('../config/cloudinary');
const { Readable } = require('stream');

// НАЗВАНИЕ ПРЕСЕТА, КОТОРЫЙ ТЫ СОЗДАЛ
const UNSIGNED_PRESET = 'booklovers_unsigned'; 

async function uploadImage(buffer, folder, publicId = null) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: `booklovers/${folder}`,
        public_id: publicId || undefined,
        upload_preset: UNSIGNED_PRESET,   // <-- ГЛАВНОЕ ДОБАВЛЕНИЕ
        transformation: [
          { quality: 'auto:good' },
          { fetch_format: 'auto' }
        ]
      },
      (error, result) => {
        if (error) {
          console.error('Ошибка загрузки в Cloudinary:', error);
          reject(error);
        } else {
          resolve({ url: result.secure_url, publicId: result.public_id });
        }
      }
    );

    const readableStream = new Readable();
    readableStream.push(buffer);
    readableStream.push(null);
    readableStream.pipe(uploadStream);
  });
}

/**
 * Удаление изображения из Cloudinary
 * @param {string} publicId - идентификатор файла
 */
async function deleteImage(publicId) {
  // Не удаляем дефолтные изображения
  if (!publicId || publicId.includes('default') || publicId.includes('default-avatar')) {
    return;
  }
  
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    if (result.result === 'ok') {
      console.log(`✅ Удалён файл: ${publicId}`);
    } else {
      console.log(`⚠️ Файл не найден: ${publicId}`);
    }
  } catch (error) {
    console.error('❌ Ошибка удаления из Cloudinary:', error);
  }
}

/**
 * Загрузка аватарки с обрезкой
 * @param {Buffer} buffer - буфер изображения
 * @param {number|string} userId - ID пользователя
 */
async function uploadAvatar(buffer, userId) {
  const publicId = `avatars/user_${userId}_${Date.now()}`;
  const result = await uploadImage(buffer, 'avatars', publicId);
  
  // Дополнительная трансформация для аватаров (квадрат, 200x200)
  const transformedUrl = cloudinary.url(result.publicId, {
    width: 200,
    height: 200,
    crop: 'fill',
    gravity: 'face',
    quality: 'auto',
    format: 'jpg'
  });
  
  return { url: transformedUrl, publicId: result.publicId };
}

/**
 * Загрузка обложки книги
 * @param {Buffer} buffer - буфер изображения
 * @param {number|string} bookId - ID книги
 */
async function uploadBookCover(buffer, bookId) {
  const publicId = `covers/book_${bookId}_${Date.now()}`;
  const result = await uploadImage(buffer, 'covers', publicId);
  
  // Трансформация для обложек (300x450)
  const transformedUrl = cloudinary.url(result.publicId, {
    width: 300,
    height: 450,
    crop: 'fill',
    quality: 'auto',
    format: 'jpg'
  });
  
  return { url: transformedUrl, publicId: result.publicId };
}

module.exports = {
  uploadImage,
  deleteImage,
  uploadAvatar,
  uploadBookCover
};