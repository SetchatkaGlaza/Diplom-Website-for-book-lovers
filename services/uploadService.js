// services/uploadService.js (unsigned версия, без подписи)
const FormData = require('form-data');
const axios = require('axios');
const { Readable } = require('stream');

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = 'booklovers_unsigned';  // твой Unsigned пресет

/**
 * Загрузка изображения в Cloudinary (unsigned)
 */
async function uploadImage(buffer, folder, publicId = null) {
  const formData = new FormData();
  // Добавляем файл
  formData.append('file', buffer, { filename: 'upload.jpg' });
  // Обязательные параметры для unsigned загрузки
  formData.append('upload_preset', UPLOAD_PRESET);
  formData.append('folder', `booklovers/${folder}`);
  if (publicId) formData.append('public_id', publicId);
  formData.append('transformation', 'q_auto:good/f_auto');

  const response = await axios.post(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
    formData,
    {
      headers: formData.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    }
  );

  return {
    url: response.data.secure_url,
    publicId: response.data.public_id
  };
}

/**
 * Удаление изображения из Cloudinary (требует подписи, но можно оставить старый метод)
 * @param {string} publicId 
 */
async function deleteImage(publicId) {
  // Для удаления потребуется подпись, но это отдельная проблема.
  // Пока оставим заглушку или возврат true.
  // Если нужно, можно реализовать удаление через подпись.
  console.log(`Удаление изображения ${publicId} пока не поддерживается в unsigned режиме`);
  return;
}

/**
 * Загрузка аватарки с предварительной обработкой (sharp)
 */
async function uploadAvatar(buffer, userId) {
  const publicId = `avatars/user_${userId}_${Date.now()}`;
  const result = await uploadImage(buffer, 'avatars', publicId);
  // Для аватаров можно вернуть URL без дополнительных трансформаций,
  // либо просто использовать полученный secure_url
  return { url: result.url, publicId: result.publicId };
}

/**
 * Загрузка обложки книги
 */
async function uploadBookCover(buffer, bookId) {
  const publicId = `covers/book_${bookId || 'new'}_${Date.now()}`;
  const result = await uploadImage(buffer, 'covers', publicId);
  return { url: result.url, publicId: result.publicId };
}

module.exports = {
  uploadImage,
  deleteImage,
  uploadAvatar,
  uploadBookCover
};