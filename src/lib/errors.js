'use strict';

const { logger } = require('./logger');

/** Ошибка с HTTP-статусом: бросаем её из маршрутов и сервисов. */
class HttpError extends Error {
  constructor(status, message, { code = null, details = null } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    if (code) this.code = code;
    if (details) this.details = details;
  }

  static notFound(message = 'Страница не найдена') {
    return new HttpError(404, message);
  }

  static forbidden(message = 'Недостаточно прав') {
    return new HttpError(403, message);
  }

  static unauthorized(message = 'Нужен вход') {
    return new HttpError(401, message);
  }

  static badRequest(message = 'Некорректный запрос', details) {
    return new HttpError(400, message, { details });
  }

  static tooMany(message = 'Слишком много запросов') {
    return new HttpError(429, message);
  }
}

function notFound(req, res, next) {
  next(HttpError.notFound(`Страница не найдена: ${req.method} ${req.originalUrl}`));
}

function wantsJson(req) {
  return req.path.startsWith('/api/') || (req.get('accept') || '').includes('application/json');
}

function errorHandler(error, req, res, next) { // eslint-disable-line no-unused-vars
  // Ответ уже отправлен — отдаём управление стандартному обработчику Express
  if (res.headersSent) return next(error);

  let status = Number(error.status) || 500;
  if (status < 400 || status > 599) status = 500;

  const isServerError = status >= 500;
  const isRateLimited = status === 429;
  const retryAfter = isRateLimited
    ? Math.ceil((req.session?.rateLimitReset || 0) / 1000) || 60
    : null;

  logger[isServerError ? 'error' : 'warn']('request failed', {
    status,
    method: req.method,
    path: req.originalUrl,
    userId: req.currentUser?.id || null,
    requestId: req.id,
    error: isServerError ? error.message : undefined,
    stack: isServerError && process.env.NODE_ENV !== 'production' ? error.stack : undefined
  });

  if (isRateLimited) res.setHeader('Retry-After', String(retryAfter));

  if (wantsJson(req)) {
    return res.status(status).json({
      error: isServerError ? 'Внутренняя ошибка сервера' : error.message,
      status
    });
  }

  const titles = {
    400: 'Некорректный запрос',
    401: 'Нужен вход',
    403: error.code === 'CSRF' ? 'Форма устарела' : 'Доступ закрыт',
    404: 'Страница не найдена',
    429: 'Слишком много запросов'
  };

  const messages = {
    400: error.message,
    401: error.message,
    403: error.code === 'CSRF'
      ? 'Обновите страницу и отправьте форму ещё раз.'
      : error.message,
    404: 'Возможно, книга переехала на другую полку. Загляните в каталог.',
    429: error.message
  };

  // Внутренние детали наружу не отдаём: пользователю — общий текст
  const message = isServerError
    ? 'Мы уже записали ошибку и посмотрим, что случилось.'
    : (messages[status] || error.message);

  const viewData = {
    title: titles[status] || 'Что-то пошло не так',
    description: 'Страница ошибки',
    status,
    message,
    retryAfter
  };

  return res.status(status).render('errors/error', viewData, (renderError, html) => {
    if (!renderError) return res.send(html);
    // Если шаблон сломан, пользователь всё равно не должен видеть стек
    logger.error('не удалось отрисовать страницу ошибки', { error: renderError.message });
    return res.type('text/plain; charset=utf-8').send(`${status}. ${viewData.title}`);
  });
}

module.exports = { HttpError, notFound, errorHandler };
