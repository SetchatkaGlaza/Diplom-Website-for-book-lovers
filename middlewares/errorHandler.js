const logger = require('../config/logger');

exports.notFound = (req, res, next) => {
  const error = new Error(`Страница не найдена - ${req.originalUrl}`);
  error.status = 404;
  next(error);
};

exports.errorHandler = (err, req, res, next) => {
  const status = err.status || 500;

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

  console.error(`[Ошибка ${status}]: ${err.message}`);
  if (status === 500) {
    console.error(err.stack);
  }

  if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
    return res.status(status).json({
      error: {
        status,
        message: status === 500 ? 'Внутренняя ошибка сервера' : err.message
      }
    });
  }

  try {
    res.status(status).render(`errors/${status}`, {
      title: status === 404 ? 'Страница не найдена' : 'Ошибка сервера',
      message: err.message,
      error: process.env.NODE_ENV === 'development' ? err : {},
      layout: 'layouts/main'
    });
  } catch {
    res.status(status).send(`
      <h1>${status === 404 ? '404 Not Found' : '500 Server Error'}</h1>
      <p>${err.message}</p>
      <a href="/">Вернуться на главную</a>
    `);
  }
};
