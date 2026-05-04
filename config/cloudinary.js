const cloudinary = require('cloudinary').v2;
require('dotenv').config();

// Настройка Cloudinary из переменных окружения
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true  // используем HTTPS URLs
});

// Проверка подключения (опционально, для отладки)
if (process.env.NODE_ENV !== 'production') {
  console.log('☁️ Cloudinary настроен для облака:', process.env.CLOUDINARY_CLOUD_NAME);
}

module.exports = cloudinary;