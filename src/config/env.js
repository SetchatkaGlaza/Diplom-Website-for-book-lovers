'use strict';

const { logger } = require('../lib/logger');

/**
 * Проверка окружения при старте.
 *
 * Смысл: упасть сразу и с понятным текстом, а не через час, когда первый
 * человек попробует зарегистрироваться и письмо уйдёт на localhost.
 * Проверяем только то, без чего продакшен не работает; остальное — warning.
 */

const PRODUCTION_REQUIRED = ['SESSION_SECRET', 'DATABASE_URL'];
const LOCAL_DEFAULTS = {
  SESSION_SECRET: 'dev-only-session-secret-change-me',
  DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:5432/knigomany'
};

function isProduction(env = process.env) {
  return env.NODE_ENV === 'production';
}

/** Адрес сайта без слэша на конце: один источник правды для писем и canonical. */
function publicUrl(env = process.env) {
  const raw = env.PUBLIC_URL || `http://localhost:${env.PORT || 3000}`;
  return raw.replace(/\/+$/, '');
}

/**
 * Собирает список проблем и предупреждений.
 * Возвращает { errors, warnings } — решение принимает вызывающий код,
 * чтобы функцию можно было проверить тестом, не роняя процесс.
 */
function inspectEnv(env = process.env) {
  const errors = [];
  const warnings = [];
  const production = isProduction(env);

  if (production) {
    PRODUCTION_REQUIRED.forEach((key) => {
      if (!env[key]) errors.push(`не задана переменная ${key}`);
    });

    if (env.SESSION_SECRET && env.SESSION_SECRET.length < 32) {
      errors.push('SESSION_SECRET короче 32 символов — такой секрет подбирается');
    }

    if (env.SESSION_SECRET === LOCAL_DEFAULTS.SESSION_SECRET) {
      errors.push('SESSION_SECRET оставлен от разработки');
    }

    if (!env.PUBLIC_URL) {
      errors.push('не задана переменная PUBLIC_URL — иначе ссылки в письмах и canonical будут вести на localhost');
    } else if (!/^https:\/\//.test(env.PUBLIC_URL)) {
      errors.push('PUBLIC_URL должен начинаться с https://');
    }

    if (!env.MAIL_FROM) {
      warnings.push('MAIL_FROM не задан: письма уйдут с адреса по умолчанию, часть почтовиков их отклонит');
    }

    if (!env.RESEND_API_KEY && !env.SMTP_HOST) {
      warnings.push('нет ни RESEND_API_KEY, ни SMTP_HOST: письма только печатаются в лог, подтверждение адреса и сброс пароля не работают');
    }

    if (env.DB_SSL === 'false' && /neon\.tech|railway|render|supabase/.test(env.DATABASE_URL || '')) {
      warnings.push('DB_SSL=false на облачной базе: проверь, разрешает ли провайдер соединение без TLS');
    }

    if (env.DB_DRIVER === 'pglite') {
      errors.push('DB_DRIVER=pglite в продакшене: база живёт в памяти и исчезнет при перезапуске');
    }
  } else {
    if (!env.SESSION_SECRET) warnings.push(`SESSION_SECRET не задан, используется ${LOCAL_DEFAULTS.SESSION_SECRET}`);
    if (!env.DATABASE_URL && !env.DB_NAME) warnings.push(`DATABASE_URL не задан, используется ${LOCAL_DEFAULTS.DATABASE_URL}`);
  }

  return { errors, warnings };
}

/**
 * Проверяет окружение и либо падает, либо пишет предупреждения в лог.
 * Вызывается из src/server.js до подключения к базе.
 */
function assertEnv({ env = process.env, exit = true, log = logger } = {}) {
  const { errors, warnings } = inspectEnv(env);

  warnings.forEach((message) => log.warn('окружение', { warning: message }));

  if (errors.length) {
    errors.forEach((message) => log.error('окружение', { error: message }));
    log.error('старт остановлен: исправь переменные окружения из списка выше');
    if (exit) process.exit(1);
    return false;
  }

  return true;
}

module.exports = { assertEnv, inspectEnv, isProduction, publicUrl, LOCAL_DEFAULTS };
