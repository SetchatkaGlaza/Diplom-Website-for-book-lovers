'use strict';

const crypto = require('node:crypto');
const helmet = require('helmet');

/**
 * HTTP-заголовки безопасности и Content-Security-Policy.
 *
 * Стили и скрипты только из своих файлов: инлайновых <style> и <script>
 * в шаблонах нет, поэтому 'unsafe-inline' не нужен.
 *
 * Единственное исключение — JSON-LD: разметку для поисковиков нельзя положить
 * в файл, потому что она зависит от страницы. Для неё выдаём одноразовый nonce
 * на каждый запрос; 'unsafe-inline' при этом не включается.
 */
function securityHeaders({ isProduction = false } = {}) {
  const directives = {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
    styleSrc: ["'self'"],
    imgSrc: ["'self'", 'data:', 'https:'],
    fontSrc: ["'self'"],
    connectSrc: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
    baseUri: ["'self'"],
    objectSrc: ["'none'"]
  };

  if (isProduction) directives.upgradeInsecureRequests = [];

  const middleware = helmet({
    contentSecurityPolicy: { directives },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: isProduction ? { maxAge: 15552000, includeSubDomains: true } : false,
    frameguard: { action: 'deny' }
  });

  // Nonce создаётся до helmet, иначе в заголовок попадёт undefined
  return function security(req, res, next) {
    res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
    return middleware(req, res, next);
  };
}

module.exports = { securityHeaders };
