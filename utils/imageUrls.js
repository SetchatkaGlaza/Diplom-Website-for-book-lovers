const path = require('path');
const fs = require('fs');
const cloudinary = require('../config/cloudinary');

function getCoverUrl(coverImage, coverPublicId) {
  if (coverImage && coverImage.startsWith('http')) return coverImage;
  if (coverPublicId) return cloudinary.url(coverPublicId, { secure: true });
  if (!coverImage || coverImage === 'default-book-cover.jpg') return '/images/covers/default-book-cover.jpg';

  const localPath = path.join(__dirname, '..', 'public', 'images', 'covers', coverImage);
  return fs.existsSync(localPath) ? `/images/covers/${coverImage}` : '/images/covers/default-book-cover.jpg';
}

function getAvatarUrl(avatar, avatarPublicId) {
  if (avatar && avatar.startsWith('http')) return avatar;
  if (avatarPublicId) return cloudinary.url(avatarPublicId, { secure: true });
  if (!avatar || avatar === 'default-avatar.png') return '/images/avatars/default-avatar.png';

  const localPath = path.join(__dirname, '..', 'public', 'images', 'avatars', avatar);
  return fs.existsSync(localPath) ? `/images/avatars/${avatar}` : '/images/avatars/default-avatar.png';
}

module.exports = { getCoverUrl, getAvatarUrl };
