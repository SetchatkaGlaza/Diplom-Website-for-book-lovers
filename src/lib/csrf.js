'use strict';

const crypto = require('crypto');

const FIELD = '_csrf';
const HEADER = 'x-csrf-token';
const SESSION_KEY = 'csrfToken';
const COOKIE_NAME = 'csrf';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

function isValidToken(token) {
  return typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);
}

/**
 * Ставит куку без сторонних зависимостей: в проекте нет cookie-parser на запись.
 */
function setCookie(res, name, value, { maxAge = COOKIE_MAX_AGE } = {}) {
  const parts = [
    `${name}=${value}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'SameSite=Lax'
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  const previous = res.getHeader('Set-Cookie');
  const header = Array.isArray(previous) ? previous : previous ? [previous] : [];
  res.setHeader('Set-Cookie', [...header, parts.join('; ')]);
}

/**
 * CSRF-защита на сессии.
 *
 * Токен живёт в сессии (не в куке), клиент получает его в форму или в заголовок.
 * Сравнение — timing-safe, чтобы нельзя было подобрать токен по времени ответа.
 * Токен не меняется между запросами: иначе открытая в двух вкладках форма
 * ломается при отправке из второй вкладки.
 *
 * Гостю токен тоже нужен: у него есть формы (вход, регистрация), а человек
 * без сессии получает новую на каждом запросе — тогда страница и форма
 * расходятся. Поэтому сессия создаётся до этой проверки (см. app.js), а для
 * гостя ставим токен в отдельную куку: её нельзя прочитать чужому сайту,
 * но можно сравнить при отправке.
 */
function csrfProtection() {
  return function csrfMiddleware(req, res, next) {
    if (!req.session) {
      const error = new Error('Нет сессии для проверки формы');
      error.status = 500;
      return next(error);
    }

    const fromCookie = req.cookies ? req.cookies[COOKIE_NAME] : null;

    if (!isValidToken(req.session[SESSION_KEY])) {
      // Сессия новая (или гость): берём токен из куки, чтобы не плодить новые токены на каждый запрос
      req.session[SESSION_KEY] = isValidToken(fromCookie) ? fromCookie : newToken();
    }

    const current = req.session[SESSION_KEY];

    // Куку видит только сервер: из JS она не читается, но и секрета в ней нет —
    // это тот же токен, что уже лежит в форме
    if (fromCookie !== current) setCookie(res, COOKIE_NAME, current);
    req.csrfToken = () => current;
    res.locals.csrfToken = current;

    if (SAFE_METHODS.has(req.method)) return next();

    const submitted = req.body?.[FIELD] || req.get(HEADER) || '';
    const expected = Buffer.from(current, 'utf8');
    const actual = Buffer.from(String(submitted), 'utf8');
    const matches = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

    if (!matches) {
      const error = new Error('Форма устарела. Обновите страницу и попробуйте снова.');
      error.status = 403;
      error.code = 'CSRF';
      return next(error);
    }

    return next();
  };
}

module.exports = { csrfProtection, newToken, isValidToken, FIELD, HEADER };
