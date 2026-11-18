'use strict';

/**
 * Ограничение частоты запросов.
 *
 * Своя реализация вместо express-rate-limit: нужно менять лимиты в тестах
 * и уметь выключать защиту только в тестах по требованию.
 * Хранение — в памяти процесса (для одного сервера этого достаточно).
 */

function createLimiter({ windowMs, max, message, keyGenerator, enabled = true, name = 'limiter' }) {
  const hits = new Map();

  function cleanup(now) {
    if (hits.size < 500) return;
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }

  function middleware(req, res, next) {
    if (!enabled) return next();

    const now = Date.now();
    const key = keyGenerator ? keyGenerator(req) : req.ip;
    let entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
      cleanup(now);
    }

    entry.count += 1;
    const remaining = Math.max(0, max - entry.count);

    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil((entry.resetAt - now) / 1000)));

    if (entry.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      const error = new Error(message || 'Слишком много запросов. Попробуйте позже.');
      error.status = 429;
      error.code = 'RATE_LIMIT';
      error.limiter = name;
      return next(error);
    }

    return next();
  }

  // Свойства вешаем через defineProperty: имя функции только для чтения
  Object.defineProperty(middleware, 'reset', { value: () => hits.clear(), configurable: true });
  Object.defineProperty(middleware, 'limiterName', { value: name, configurable: true });
  Object.defineProperty(middleware, 'stats', { value: () => hits.size, configurable: true });

  return middleware;
}

function byIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Набор лимитов приложения. Лимиты выключены в тестах, кроме тех случаев,
 * когда тест сам создаёт limiter с enabled: true.
 */
function createLimiters({ enabled = process.env.NODE_ENV !== 'test' } = {}) {
  return {
    auth: createLimiter({
      name: 'auth',
      windowMs: 15 * 60 * 1000,
      max: 20,
      message: 'Слишком много попыток входа. Попробуйте через 15 минут.',
      keyGenerator: byIp,
      enabled
    }),
    register: createLimiter({
      name: 'register',
      windowMs: 60 * 60 * 1000,
      max: 10,
      message: 'Слишком много регистраций с этого адреса.',
      keyGenerator: byIp,
      enabled
    }),
    write: createLimiter({
      name: 'write',
      windowMs: 10 * 60 * 1000,
      max: 40,
      keyGenerator: (req) => (req.currentUser ? `u:${req.currentUser.id}` : byIp(req)),
      enabled
    }),
    search: createLimiter({
      name: 'search',
      windowMs: 60 * 1000,
      max: 60,
      keyGenerator: byIp,
      enabled
    }),
    contact: createLimiter({
      name: 'contact',
      windowMs: 60 * 60 * 1000,
      max: 5,
      keyGenerator: byIp,
      enabled
    })
  };
}

module.exports = { createLimiter, createLimiters, byIp };
