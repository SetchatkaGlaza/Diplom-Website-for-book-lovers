const imageHelper = require('../utils/imageHelper');

module.exports = (req, res, next) => {
  res.locals.imageHelper = {
    avatar: (name, role) => imageHelper.getAvatarPath(name, role),
    cover: (name) => imageHelper.getCoverPath(name),
    thumb: (name) => imageHelper.getThumbPath(name),
    webp: (path) => imageHelper.getWebpPath(path),
    srcset: (path, sizes) => imageHelper.getSrcSet(path, sizes)
  };

  next();
};
