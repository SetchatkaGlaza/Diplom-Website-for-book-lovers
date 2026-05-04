const cloudinary = require('../config/cloudinary');

const DEFAULT_AVATAR_PUBLIC_ID = 'booklovers/avatars/default-avatar';
const DEFAULT_COVER_PUBLIC_ID = 'booklovers/covers/default-book-cover';

const streamUpload = (buffer, options = {}) => new Promise((resolve, reject) => {
  const uploadStream = cloudinary.uploader.upload_stream(options, (error, result) => {
    if (error) {
      reject(error);
      return;
    }
    resolve(result);
  });

  uploadStream.end(buffer);
});

async function uploadImage(buffer, folder, publicId = null) {
  const options = {
    folder: `booklovers/${folder}`,
    resource_type: 'image',
    quality: 'auto:good',
    fetch_format: 'auto'
  };

  if (publicId) options.public_id = publicId;

  const result = await streamUpload(buffer, options);

  return {
    url: result.secure_url,
    publicId: result.public_id
  };
}

async function deleteImage(publicId) {
  if (!publicId || [DEFAULT_AVATAR_PUBLIC_ID, DEFAULT_COVER_PUBLIC_ID].includes(publicId)) {
    return;
  }

  await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
}

async function uploadAvatar(buffer, userId) {
  const publicId = `user_${userId}_${Date.now()}`;
  return uploadImage(buffer, 'avatars', publicId);
}

async function uploadBookCover(buffer, bookId) {
  const publicId = `book_${bookId || 'new'}_${Date.now()}`;
  return uploadImage(buffer, 'covers', publicId);
}

function buildCloudinaryUrl(publicId) {
  if (!publicId) return null;
  return cloudinary.url(publicId, { secure: true });
}

module.exports = {
  uploadImage,
  deleteImage,
  uploadAvatar,
  uploadBookCover,
  buildCloudinaryUrl
};
