'use strict';

/**
 * Один адрес сайта вместо четырёх.
 *
 * http/https и www/без-www — технически разные адреса: поисковик видит две
 * копии сайта, cookie не склеивается, ссылки в письмах ведут не туда.
 * Здесь остаётся ровно один адрес из PUBLIC_URL, остальные получают
 * постоянный редирект (308 — сохраняет метод и тело запроса).
 *
 * В разработке middleware выключен: на localhost https нет и не будет.
 */
function httpsRedirect({ enabled = false, env = process.env } = {}) {
  if (!enabled) {
    return function passthrough(req, res, next) {
      return next();
    };
  }

  const canonical = new URL(env.PUBLIC_URL || 'https://knigomany.ru');
  const canonicalHost = canonical.hostname;

  return function normalize(req, res, next) {
    // healthcheck хостинга должен отвечать всегда: иначе деплой считают упавшим
    if (req.path === '/healthz') return next();

    // За прокси настоящий протокол и хост лежат в X-Forwarded-*
    const proto = String(req.get('x-forwarded-proto') || req.protocol || 'http')
      .split(',')[0].trim();
    const host = String(req.get('x-forwarded-host') || req.get('host') || canonicalHost)
      .split(',')[0].trim()
      .replace(/:\d+$/, '');

    // Любой другой домен (включая www и старый адрес) уводим на канонический:
    // иначе сайт индексируется по всякому адресу, который на него смотрит
    if (proto !== 'https' || host !== canonicalHost) {
      return res.redirect(308, canonical.origin + req.originalUrl);
    }

    return next();
  };
}

module.exports = { httpsRedirect };
