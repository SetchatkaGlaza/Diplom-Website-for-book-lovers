const multer = require('multer');
const path = require('path');
const fs = require('fs');

const MB = 1024 * 1024;
const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

const ensureDirectory = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const createDiskStorage = ({ destinationDir, filenamePrefix }) => multer.diskStorage({
  destination: (req, file, cb) => {
    ensureDirectory(destinationDir);
    cb(null, destinationDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${filenamePrefix}-${uniqueSuffix}${ext}`);
  }
});

const imageFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (IMAGE_MIME_TYPES.includes(file.mimetype) || IMAGE_EXTENSIONS.includes(ext)) {
    cb(null, true);
    return;
  }
  cb(new Error('Неподдерживаемый формат изображения. Используйте JPG, PNG, GIF или WEBP'), false);
};

module.exports = {
  MB,
  createDiskStorage,
  imageFileFilter,
  ensureDirectory
};
