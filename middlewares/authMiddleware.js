/**
 * Проверяет, авторизован ли пользователь
 */
exports.requireAuth = (req, res, next) => {
  if (req.session.user) {
    return next();
  }
  
  req.flash('error', 'Пожалуйста, войдите в систему');
  res.redirect('/auth/login');
};

/**
 * Проверяет, является ли пользователь гостем (не авторизован)
 */
exports.requireGuest = (req, res, next) => {
  if (!req.session.user) {
    return next();
  }
  
  res.redirect('/');
};

/**
 * Проверяет, является ли пользователь администратором
 */
exports.requireAdmin = (req, res, next) => {
  if (req.session.user && (req.session.user.role === 'admin' || req.session.user.role === 'moderator')) {
    return next();
  }
  
  req.flash('error', 'Доступ запрещён. Требуются права администратора');
  res.redirect('/');
};

/**
 * Проверяет, является ли пользователь супер-администратором (только admin)
 */
exports.requireSuperAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  
  req.flash('error', 'Доступ запрещён. Требуются права супер-администратора');
  res.redirect('/admin');
};