const logger = require('../config/logger');

/**
 * Middleware для обработки ошибок 404 (Страница не найдена)
 */
exports.notFound = (req, res, next) => {
  const error = new Error(`Страница не найдена - ${req.originalUrl}`);
  error.status = 404;
  next(error);
};

/**
 * Middleware для обработки всех ошибок (500, 404 и т.д.)
 */
exports.errorHandler = (err, req, res, next) => {
  const status = err.status || 500;
  
  // Логируем ошибку (если есть логгер)
  if (logger && typeof logger.error === 'function') {
    logger.error({
      message: err.message,
      status,
      url: req.originalUrl,
      method: req.method,
      ip: req.ip,
      stack: err.stack,
      timestamp: new Date().toISOString()
    });
  }
  
  // Логируем ошибку в консоль
  console.error(`[Ошибка ${status}]: ${err.message}`);
  if (status === 500) {
    console.error(err.stack);
  }
  
  // Для AJAX запросов возвращаем JSON
  if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
    return res.status(status).json({
      error: {
        status,
        message: status === 500 ? 'Внутренняя ошибка сервера' : err.message
      }
    });
  }
  
  // Для обычных запросов рендерим страницу ошибки
  try {
    res.status(status).render(`errors/${status}`, {
      title: status === 404 ? 'Страница не найдена' : 'Ошибка сервера',
      message: err.message,
      error: process.env.NODE_ENV === 'development' ? err : {}, // Показываем детали только в разработке
      layout: 'layouts/main'
    });
  } catch (renderError) {
    // Если даже страница ошибки не найдена, отправляем простой текст
    res.status(status).send(`
      <h1>${status === 404 ? '404 Not Found' : '500 Server Error'}</h1>
      <p>${err.message}</p>
      <a href="/">Вернуться на главную</a>
    `);
  }
};