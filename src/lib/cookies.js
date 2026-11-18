'use strict';

/**
 * Минимальный парсер Cookie (без сторонних зависимостей).
 * Нужен для double-submit CSRF рядом с httpOnly-кукой.
 */
function parseCookies(header = '') {
  return String(header)
    .split(';')
    .reduce((acc, part) => {
      const index = part.indexOf('=');
      if (index < 0) return acc;
      const key = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      if (!key) return acc;
      try {
        acc[key] = decodeURIComponent(value);
      } catch {
        acc[key] = value;
      }
      return acc;
    }, {});
}

function parseCookiesMiddleware() {
  return function cookies(req, res, next) {
    req.cookies = parseCookies(req.headers.cookie);
    next();
  };
}

module.exports = { parseCookies, parseCookiesMiddleware };
