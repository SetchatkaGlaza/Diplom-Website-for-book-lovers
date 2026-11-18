'use strict';

const text = require('../lib/text');
const { jsonLd, bookJsonLd, reviewJsonLd } = require('../lib/seo');
const { publicUrl } = require('../config/env');

/**
 * Общие переменные для шаблонов: хелперы, текущий путь, пользователь, CSRF.
 */
function viewContext({ Notification, services = {} }) {
  return async function viewMiddleware(req, res, next) {
    try {
      res.locals.t = text;
      // Ширина полосы прогресса задаётся классом, а не атрибутом style:
      // встроенные стили запрещены политикой безопасности (CSP).
      res.locals.progressClass = (percent) => `progress__bar--step${Math.min(20, Math.max(0, Math.ceil((Number(percent) || 0) / 5)))}`;
      res.locals.currentPath = req.path;
      // Канонический адрес и база для Open Graph: считаем от PUBLIC_URL,
      // а не от заголовка Host — иначе сайт индексируется по чужому домену
      const seoBase = publicUrl();
      res.locals.seoBase = seoBase;
      // Абсолютные адреса нужны только поисковикам и соцсетям: человеку — путь
      res.locals.canonicalPath = (extra = '') => seoBase + (extra || req.originalUrl || req.path);
      res.locals.canonical = `${seoBase}${req.path}`;
      // Личные разделы не индексируем: там переписка, настройки и статистика
      const privatePrefixes = ['/polka', '/nastroyki', '/soobshcheniya', '/uvedomleniya', '/lenta',
        '/statistika', '/knizhnyy-god', '/import', '/eksport', '/start', '/admin', '/vhod',
        '/registratsiya', '/vosstanovit-parol', '/chitateli'];
      res.locals.robotsNoindex = privatePrefixes.some((prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`));
      res.locals.jsonLd = jsonLd;
      res.locals.structuredBook = (book) => bookJsonLd(book, seoBase);
      res.locals.structuredReview = reviewJsonLd;
      res.locals.query = req.query || {};
      res.locals.siteName = 'Книгоманы';
      // Тему выбирает человек кнопкой в шапке; выбор живёт в cookie полгода
      res.locals.themeMode = req.cookies && req.cookies.theme === 'dark' ? 'dark' : 'light';
      res.locals.year = new Date().getFullYear();
      res.locals.currentUser = res.locals.currentUser || null;
      res.locals.unreadCount = 0;
      // Значения по умолчанию: layout рендерится и в обработчике ошибок,
      // когда часть middleware ещё не успела отработать
      res.locals.title = res.locals.title || null;
      res.locals.description = res.locals.description
        || 'Читательский дневник: полка, прогресс чтения, статистика, рецензии и клубы.';
      res.locals.bodyClass = res.locals.bodyClass || '';
      res.locals.csrfToken = res.locals.csrfToken || '';
      res.locals.flash = res.locals.flash || { success: [], error: [], info: [] };

      if (req.currentUser && Notification) {
        res.locals.unreadCount = await Notification.count({
          where: { userId: req.currentUser.id, isRead: false }
        });
        res.locals.newMessages = services.socialService
          ? await services.socialService.unreadMessages(req.currentUser.id)
          : 0;
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { viewContext };
