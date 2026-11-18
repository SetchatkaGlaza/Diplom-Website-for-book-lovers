'use strict';

const path = require('path');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const methodOverride = require('method-override');

const compression = require('compression');
const { securityHeaders } = require('./lib/security');
const { httpsRedirect } = require('./lib/https');
const { requestId } = require('./lib/request-id');
const { createMetrics } = require('./lib/metrics');
const { requestLogger } = require('./lib/logger');
const { parseCookiesMiddleware } = require('./lib/cookies');
const { csrfProtection } = require('./lib/csrf');
const { flashMiddleware } = require('./lib/flash');
const { notFound, errorHandler } = require('./lib/errors');
const { createLimiters } = require('./lib/rate-limit');
const { createAuthMiddleware } = require('./middlewares/auth');
const { viewContext } = require('./middlewares/view');
const { createAuthService } = require('./services/auth');
const { createTokenService } = require('./services/tokens');
const { createCatalogService } = require('./services/catalog');
const { createShelfService } = require('./services/shelf');
const { createReviewService } = require('./services/reviews');
const { createSocialService } = require('./services/social');
const { createStatsService } = require('./services/stats');
const { createClubService } = require('./services/clubs');
const { createOnboardingService } = require('./services/onboarding');
const { createImportService } = require('./services/import');
const { createModerationService } = require('./services/moderation');
const { createAdminService } = require('./services/admin');
const { createContentService } = require('./services/content');
const { buildArticleService } = require('./services/articles');
const { createDigestService } = require('./services/digest');
const { sendDigestEmail } = require('./lib/mailer');
const { publicUrl } = require('./config/env');

const ROOT = path.resolve(__dirname, '..');

/**
 * Создание приложения.
 *
 * Все зависимости (модели, сессии, лимиты) внедряются снаружи:
 * прод передаёт настоящую БД, тесты — PGlite в памяти.
 */
function createApp(options = {}) {
  const models = options.models;
  if (!models) throw new Error('createApp: нужны models');

  const isProduction = process.env.NODE_ENV === 'production';
  // Модели создаются фабрикой и не всегда несут sequelize внутри: прод
  // подкладывает его в объект, тесты — нет. Ищем один раз и передаём сервисам.
  const db = models.sequelize || (models.User && models.User.sequelize);
  if (!db) throw new Error('createApp: не удалось определить sequelize');
  const sessionMiddleware = options.sessionMiddleware || null;
  const limiters = options.limiters || createLimiters();

  const app = express();
  // Метрики создаются вместе с приложением: тесты получают свой счётчик
  const metrics = options.metrics || createMetrics();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(expressLayouts);
  app.set('layout', 'layouts/main');

  // --- инфраструктура ---
  // Редиректы https и www — до всего остального: иначе один и тот же сайт
  // живёт на двух адресах, и поисковик индексирует копию
  app.use(httpsRedirect({ enabled: isProduction }));
  app.use(metrics.middleware());
  app.use(requestId());
  app.use(requestLogger());
  app.use(compression()); // gzip для HTML и CSS: страницы книги весят 40–60 КБ
  app.use(securityHeaders({ isProduction }));

  // --- тело запроса ---
  app.use(express.urlencoded({ extended: false, limit: '200kb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(methodOverride('_method'));

  // --- статика ---
  app.use('/assets', express.static(path.join(ROOT, 'public'), {
    maxAge: isProduction ? '30d' : 0,
    immutable: isProduction,
    fallthrough: true
  }));

  // --- сессии и пользователь ---
  app.use(parseCookiesMiddleware());
  if (sessionMiddleware) app.use(sessionMiddleware);
  app.use(flashMiddleware());

  const auth = createAuthMiddleware({ User: models.User });
  app.use(loadUserSafe(auth, models));

  // Сервисы собираются один раз и передаются в маршруты
  const services = {
    authService: createAuthService({ User: models.User, sequelize: db }),
    tokenService: createTokenService({ Token: models.Token }),
    socialService: createSocialService({
      User: models.User,
      Follow: models.Follow,
      Activity: models.Activity,
      Notification: models.Notification,
      Conversation: models.Conversation,
      Message: models.Message,
      Quote: models.Quote,
      Book: models.Book,
      Review: models.Review,
      sequelize: db
    }),
    clubService: createClubService({
      Club: models.Club,
      ClubMember: models.ClubMember,
      ClubPost: models.ClubPost,
      ClubRequest: models.ClubRequest,
      ClubInvite: models.ClubInvite,
      ClubSchedule: models.ClubSchedule,
      Book: models.Book,
      User: models.User,
      LibraryEntry: models.LibraryEntry,
      Notification: models.Notification,
      Activity: models.Activity,
      sequelize: db
    }),
    moderationService: createModerationService({
      Report: models.Report,
      Review: models.Review,
      ReviewComment: models.ReviewComment,
      ClubPost: models.ClubPost,
      User: models.User,
      Book: models.Book,
      LibraryEntry: models.LibraryEntry,
      ModerationLog: models.ModerationLog,
      sequelize: db
    }),
    onboardingService: createOnboardingService({
      Genre: models.Genre,
      Book: models.Book,
      LibraryEntry: models.LibraryEntry,
      ReadingGoal: models.ReadingGoal,
      sequelize: db
    }),
    importService: createImportService({
      Book: models.Book,
      LibraryEntry: models.LibraryEntry,
      Review: models.Review,
      Genre: models.Genre,
      sequelize: db
    }),
    statsService: createStatsService({
      LibraryEntry: models.LibraryEntry,
      Book: models.Book,
      Review: models.Review,
      ReadingGoal: models.ReadingGoal,
      sequelize: db
    }),
    reviewService: createReviewService({
      Review: models.Review,
      Book: models.Book,
      ReviewLike: models.ReviewLike,
      ReviewComment: models.ReviewComment,
      LibraryEntry: models.LibraryEntry,
      Activity: models.Activity,
      sequelize: db
    }),
    shelfService: createShelfService({
      LibraryEntry: models.LibraryEntry,
      Book: models.Book,
      ReadingGoal: models.ReadingGoal,
      sequelize: db
    }),
    contentService: createContentService({
      Book: models.Book,
      BookGenre: models.BookGenre,
      Genre: models.Genre,
      Collection: models.Collection,
      CollectionBook: models.CollectionBook,
      Author: models.Author,
      Club: models.Club,
      ClubMember: models.ClubMember,
      ClubSchedule: models.ClubSchedule,
      User: models.User,
      sequelize: db
    }),
    adminService: createAdminService({
      User: models.User,
      Book: models.Book,
      LibraryEntry: models.LibraryEntry,
      Review: models.Review,
      Activity: models.Activity,
      sequelize: db
    }),
    digestService: createDigestService({
      User: models.User,
      LibraryEntry: models.LibraryEntry,
      Book: models.Book,
      Digest: models.Digest,
      EmailUnsubscribe: models.EmailUnsubscribe,
      ReadingGoal: models.ReadingGoal,
      sequelize: db,
      // Отправку можно подменить в тестах: тогда письма не уходят наружу
      send: options.sendMail || sendDigestEmail,
      baseUrl: options.publicUrl || publicUrl
    }),
    catalogService: createCatalogService({
      Book: models.Book,
      Genre: models.Genre,
      LibraryEntry: models.LibraryEntry,
      Review: models.Review
    })
  };

  // «Журнал» — единственный контент, который живёт не в базе: статьи читаются
  // из content/articles.json один раз при старте. Сервис кладём и в services,
  // и в locals: маршрут берёт его оттуда, тесты могут подменить.
  try {
    app.locals.articlesService = buildArticleService({ dir: options.contentDir });
    services.articleService = app.locals.articlesService;
  } catch (error) {
    // Битые статьи не должны ронять сайт целиком: каталог и полка важнее
    app.locals.articlesService = null;
    services.articleService = null;
    // eslint-disable-next-line no-console
    console.error(`[журнал] ${error.message}`);
  }

  // --- общие данные для шаблонов (до CSRF: страница ошибки тоже их использует) ---
  app.use(viewContext({ Notification: models.Notification, services }));

  // --- защита форм ---
  app.use(csrfProtection());

  // --- маршруты ---
  app.use('/', require('./routes/home')({ models }));
  app.use('/', require('./routes/auth')({ models, services, auth }));
  app.use('/', require('./routes/account')({ models, services, auth }));
  app.use('/', require('./routes/catalog')({ models, services, auth }));
  app.use('/', require('./routes/shelf')({ models, services, auth }));
  app.use('/', require('./routes/reviews')({ models, services, auth }));
  app.use('/', require('./routes/social')({ models, services, auth }));
  app.use('/', require('./routes/stats')({ models, services, auth }));
  app.use('/', require('./routes/clubs')({ models, services, auth }));
  app.use('/', require('./routes/onboarding')({ models, services, auth }));
  app.use('/', require('./routes/moderation')({ models, services, auth }));
  app.use('/', require('./routes/discover')({ models, services }));
  app.use('/', require('./routes/launch')({ models, services, auth }));
  app.use('/', require('./routes/journal')({ services }));
  // Картинки рисуем на сервере: обложки, аватары, портреты авторов.
  // Отдаём PNG, а не SVG: SVG может содержать скрипт и исполнится на нашем домене.
  app.use('/', require('./routes/images')({ models, services }));
  app.use('/', require('./routes/digest')({ models, services, auth }));
  app.use('/', require('./routes/seo')({ models, services }));
  /**
   * Проверка живости: короткий ответ, который дёргает монитор.
   *
   * Отвечает 503, если база не отвечает: сервер без базы «жив», но бесполезен,
   * и лучше, чтобы монитор сказал об этом раньше людей.
   */
  app.get('/healthz', async (req, res) => {  // no-limiter: монитор должен видеть ответ всегда
    const startedAt = Date.now();
    let dbOk = true;
    try {
      await db.query('SELECT 1');
    } catch (error) {
      dbOk = false;
      req.log?.error?.('healthz: база не отвечает', { error: error.message });
    }

    return res.status(dbOk ? 200 : 503).json({
      ok: dbOk,
      requestId: req.id,
      dbLatencyMs: Date.now() - startedAt,
      uptimeSec: Math.round(process.uptime())
    });
  });

  /** Метрики для монитора. Закрыты ключом: там видно нагрузку и ошибки. */
  app.get('/metriki', (req, res) => {
    const expected = process.env.METRICS_TOKEN;
    if (!expected) {
      // Без токена маршрут выключен: иначе на большом сайте это утечка
      return res.status(404).json({ error: 'Метрики не включены' });
    }
    if (req.get('authorization') !== `Bearer ${expected}` && req.query.token !== expected) {
      return res.status(403).json({ error: 'Нужен токен' });
    }

    return res.json(metrics.snapshot());
  });

  // Тестовые маршруты: подключаются только тестами, в проде их нет
  if (typeof options.extraRoutes === 'function') options.extraRoutes(app);

  // --- ошибки ---
  app.use(notFound);
  app.use(errorHandler);

  app.locals.limiters = limiters;
  app.locals.services = services;
  app.locals.metrics = metrics;
  return app;
}

/**
 * loadUser требует сессию. Если приложение собрано без сессий (например,
 * для проверки статики), подставляем заглушку — гость.
 */
function loadUserSafe(auth, models) {
  const loader = auth.loadUser;
  return function loadUserWithFallback(req, res, next) {
    if (!req.session) {
      res.locals.currentUser = null;
      return next();
    }
    req.session.user = req.session.user || null;
    return loader(req, res, next);
  };
}

module.exports = { createApp };
