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

  getAvatarPath(avatarName, role = 'user') {
    if (!avatarName) return this.defaultAvatars[role] || this.defaultAvatars.user;

    const avatarPath = `/images/avatars/${avatarName}`;
    const fullPath = path.join(__dirname, '../public', avatarPath);
    return fs.existsSync(fullPath) ? avatarPath : (this.defaultAvatars[role] || this.defaultAvatars.user);
  }

  getCoverPath(coverName) {
    if (!coverName || coverName === 'default-book-cover.jpg') return this.defaultCovers;

    const coverPath = `/images/covers/${coverName}`;
    const fullPath = path.join(__dirname, '../public', coverPath);
    return fs.existsSync(fullPath) ? coverPath : this.defaultCovers;
  }

  getThumbPath(coverName) {
    if (!coverName || coverName === 'default-book-cover.jpg') return this.defaultCovers;

    const thumbName = coverName.replace(/\.\w+$/, '-thumb.jpg');
    const thumbPath = `/images/covers/${thumbName}`;
    const fullPath = path.join(__dirname, '../public', thumbPath);
    return fs.existsSync(fullPath) ? thumbPath : this.getCoverPath(coverName);
  }

  getSrcSet(basePath, sizes = [300, 600, 900]) {
    if (!basePath || basePath.includes('default')) return '';

    const ext = path.extname(basePath);
    const base = basePath.replace(ext, '');
    return sizes.map((size) => `${base}-${size}${ext} ${size}w`).join(', ');
  }

  getWebpPath(imagePath) {
    if (!imagePath || imagePath.includes('default')) return imagePath;

    const webpPath = imagePath.replace(/\.(jpg|jpeg|png)$/i, '.webp');
    const fullPath = path.join(__dirname, '../public', webpPath);
    return fs.existsSync(fullPath) ? webpPath : imagePath;
  }
}

module.exports = new ImageHelper();
