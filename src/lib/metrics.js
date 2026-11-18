'use strict';

/**
 * Метрики для внешнего мониторинга.
 *
 * Смысл: чтобы узнать «сервер жив», не нужно смотреть глазами. Монитор раз в
 * минуту дёргает `/healthz` (простой ответ 200/503), а раз в несколько минут —
 * `/metriki` (JSON с числами). Метрики только читают состояние: ни одной записи
 * в базу на каждый запрос, иначе сам мониторинг создаёт нагрузку.
 *
 * Счётчики живут в памяти процесса: после рестарта начинаются с нуля. Для
 * «сколько ошибок за последние 5 минут» этого достаточно, для истории —
 * нужен внешний сервис, и это следующий шаг (Sentry, этап 18.2).
 */

const MAX_STATUS_KEYS = 100;

function createMetrics() {
  const startedAt = Date.now();
  const counters = {
    requests: 0,
    serverErrors: 0,
    clientErrors: 0,
    rateLimited: 0,
    slowRequests: 0
  };
  const byStatus = new Map();
  const byMethod = new Map();
  let slowestMs = 0;
  let lastRequestAt = null;

  function bump(map, key) {
    if (map.size > MAX_STATUS_KEYS && !map.has(key)) return;
    map.set(key, (map.get(key) || 0) + 1);
  }

  /** Middleware: считает по факту завершения ответа, а не по началу. */
  function middleware() {
    return function countRequest(req, res, next) {
      const startedAtNs = process.hrtime.bigint();

      res.on('finish', () => {
        const durationMs = Number((process.hrtime.bigint() - startedAtNs) / 1000000n);

        counters.requests += 1;
        lastRequestAt = new Date().toISOString();
        if (durationMs > slowestMs) slowestMs = durationMs;
        if (durationMs >= 1000) counters.slowRequests += 1;

        bump(byStatus, String(res.statusCode));
        bump(byMethod, req.method);

        if (res.statusCode >= 500) counters.serverErrors += 1;
        else if (res.statusCode === 429) counters.rateLimited += 1;
        else if (res.statusCode >= 400) counters.clientErrors += 1;

        // Долгие запросы важнее средних: по ним видно, что база тормозит
        if (durationMs >= 1000) {
          require('./logger').logger.warn('медленный запрос', {
            method: req.method,
            path: req.originalUrl,
            status: res.statusCode,
            durationMs
          });
        }
      });

      next();
    };
  }

  /** Снимок для /metriki: короткие ключи, без внутренних деталей. */
  function snapshot({ ready = true, dbLatencyMs = null } = {}) {
    return {
      ok: ready,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      startedAt: new Date(startedAt).toISOString(),
      lastRequestAt,
      counters: { ...counters },
      byStatus: Object.fromEntries([...byStatus.entries()].sort()),
      byMethod: Object.fromEntries([...byMethod.entries()].sort()),
      slowestMs,
      dbLatencyMs,
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      nodeVersion: process.version
    };
  }

  /** Для тестов: обнулить накопленное. */
  function reset() {
    Object.keys(counters).forEach((key) => { counters[key] = 0; });
    byStatus.clear();
    byMethod.clear();
    slowestMs = 0;
    lastRequestAt = null;
  }

  return { middleware, snapshot, reset };
}

module.exports = { createMetrics };
