/**
 * Проверяет, авторизован ли пользователь
 * Если нет — редирект на страницу входа
 */
exports.requireAuth = (req, res, next) => {
  if (req.session.user) {
    // пользователь есть — идём дальше
    return next();
  }
  
  // пользователя нет — сохраняем сообщение и редирект на логин
  req.flash('error', 'Пожалуйста, войдите в систему');
  res.redirect('/auth/login');
};

/**
 * Проверяет, является ли пользователь гостем (не авторизован)
 * Если авторизован — редирект на главную
 */
exports.requireGuest = (req, res, next) => {
  if (!req.session.user) {
    // гость — идём дальше
    return next();
  }
  
  res.redirect('/');
};

/**
 * Проверяет, является ли пользователь администратором
 */
exports.requireAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  
  req.flash('error', 'Доступ запрещён');
  res.redirect('/');
};