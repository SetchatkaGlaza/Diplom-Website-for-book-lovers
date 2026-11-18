'use strict';

/**
 * Простой структурный логгер без зависимостей.
 * Уровни: error > warn > info > debug. В тестах молчит по умолчанию.
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function currentLevel() {
  const name = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'error' : 'info');
  return LEVELS[name] ?? LEVELS.info;
}

const SECRET_KEYS = /pass|secret|token|key|cookie|authorization/i;

/** Убираем пароли и токены, чтобы они не попали в логи. */
function redact(value, depth = 0) {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, depth + 1));

  return Object.entries(value).reduce((acc, [key, item]) => {
    acc[key] = SECRET_KEYS.test(key) ? '[скрыто]' : redact(item, depth + 1);
    return acc;
  }, {});
}

function write(level, message, meta) {
  if (LEVELS[level] > currentLevel()) return;

  const line = {
    time: new Date().toISOString(),
    level,
    message
  };
  if (meta && Object.keys(meta).length) line.meta = redact(meta);

  const text = JSON.stringify(line);
  if (level === 'error') console.error(text);
  else console.log(text);
}

/**
 * Логирование запросов: метод, путь, статус, длительность и requestId.
 * Для статики не пишем, чтобы не засорять журнал.
 */
function requestLogger() {
  return function logRequest(req, res, next) {
    const startedAt = process.hrtime.bigint();
    req.startedAt = startedAt;

    res.on('finish', () => {
      if (req.path.startsWith('/assets/') || req.path.startsWith('/images/')) return;
      const durationMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      write(level, 'request', {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs,
        userId: req.currentUser?.id || null
      });
    });

    next();
  };
}

module.exports = {
  logger: {
    error: (message, meta) => write('error', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    info: (message, meta) => write('info', message, meta),
    debug: (message, meta) => write('debug', message, meta)
  },
  requestLogger,
  redact
};
