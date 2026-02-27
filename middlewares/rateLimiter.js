const rateLimit = require('express-rate-limit');

// Общий лимитер для всех запросов
exports.globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 100, // максимум 100 запросов с одного IP
  message: {
    error: 'Слишком много запросов. Пожалуйста, повторите позже.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Строгий лимитер для авторизации
exports.authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 час
  max: 10, // максимум 10 попыток
  skipSuccessfulRequests: true, // не считаем успешные попытки
  message: {
    error: 'Слишком много попыток входа. Попробуйте через час.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Лимитер для восстановления пароля
exports.resetPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 час
  max: 3, // максимум 3 запроса на сброс пароля
  message: {
    error: 'Слишком много запросов на сброс пароля. Попробуйте через час.'
  },
  standardHeaders: true,
  legacyHeaders: false
});