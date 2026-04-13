// utils/imageHelper.js
const path = require('path');
const fs = require('fs');

class ImageHelper {
  constructor() {
    this.defaultAvatars = {
      user: '/images/avatars/default-avatar.png',
      admin: '/images/avatars/admin-avatar.png'
    };
    
    this.defaultCovers = '/images/covers/default-book-cover.jpg';
  }

  /**
   * Получение пути к аватарке с проверкой существования
   */
  getAvatarPath(avatarName, role = 'user') {
    if (!avatarName) {
      return this.defaultAvatars[role] || this.defaultAvatars.user;
    }

    const avatarPath = `/images/avatars/${avatarName}`;
    const fullPath = path.join(__dirname, '../public', avatarPath);
    
    // Проверяем существование файла
    if (fs.existsSync(fullPath)) {
      return avatarPath;
    }
    
    return this.defaultAvatars[role] || this.defaultAvatars.user;
  }

  /**
   * Получение пути к обложке с проверкой
   */
  getCoverPath(coverName) {
    if (!coverName || coverName === 'default-book-cover.jpg') {
      return this.defaultCovers;
    }

    const coverPath = `/images/covers/${coverName}`;
    const fullPath = path.join(__dirname, '../public', coverPath);
    
    if (fs.existsSync(fullPath)) {
      return coverPath;
    }
    
    return this.defaultCovers;
  }

  /**
   * Получение пути к миниатюре обложки
   */
  getThumbPath(coverName) {
    if (!coverName || coverName === 'default-book-cover.jpg') {
      return this.defaultCovers;
    }

    const thumbName = coverName.replace(/\.\w+$/, '-thumb.jpg');
    const thumbPath = `/images/covers/${thumbName}`;
    const fullPath = path.join(__dirname, '../public', thumbPath);
    
    if (fs.existsSync(fullPath)) {
      return thumbPath;
    }
    
    return this.getCoverPath(coverName);
  }

  /**
   * Генерация srcset для адаптивных изображений
   */
  getSrcSet(basePath, sizes = [300, 600, 900]) {
    if (!basePath || basePath.includes('default')) {
      return '';
    }

    const ext = path.extname(basePath);
    const base = basePath.replace(ext, '');
    
    return sizes
      .map(size => `${base}-${size}${ext} ${size}w`)
      .join(', ');
  }

  /**
   * Получение WebP версии для современных браузеров
   */
  getWebpPath(imagePath) {
    if (!imagePath || imagePath.includes('default')) {
      return imagePath;
    }

    const webpPath = imagePath.replace(/\.(jpg|jpeg|png)$/i, '.webp');
    const fullPath = path.join(__dirname, '../public', webpPath);
    
    if (fs.existsSync(fullPath)) {
      return webpPath;
    }
    
    return imagePath;
  }
}

module.exports = new ImageHelper();