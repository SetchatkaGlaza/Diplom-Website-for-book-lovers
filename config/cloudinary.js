const cloudinary = require('cloudinary').v2;
require('dotenv').config();

// Настройка Cloudinary из переменных окружения
const getEnv = (name) => (process.env[name] || '').trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '');

const cloudName = getEnv('CLOUDINARY_CLOUD_NAME');
const apiKey = getEnv('CLOUDINARY_API_KEY');
const apiSecret = getEnv('CLOUDINARY_API_SECRET');

cloudinary.config({
  cloud_name: cloudName,
  api_key: apiKey,
  api_secret: apiSecret,
  secure: true
});

// Проверка подключения (опционально, для отладки)
if (process.env.NODE_ENV !== 'production') {
  console.log('☁️ Cloudinary настроен для облака:', process.env.CLOUDINARY_CLOUD_NAME);
}

module.exports = cloudinary;

if (!cloudName || !apiKey || !apiSecret) {
  console.warn('⚠️ Cloudinary env переменные заполнены не полностью.');
}
