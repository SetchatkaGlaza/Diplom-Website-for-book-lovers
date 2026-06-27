require('dotenv').config({ quiet: true });
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const expressLayouts = require('express-ejs-layouts');
const methodOverride = require('method-override');
const rateLimit = require('express-rate-limit');

const { DataTypes } = require('sequelize');
const sequelize = require('./config/database');
const { EMPTY_STATS, getSiteStats } = require('./services/statsService');
const { getCommunityActivity, getHomePageData } = require('./services/homeService');
const authRoutes = require('./routes/auth');
const bookRoutes = require('./routes/books');
const profileRoutes = require('./routes/profile');
const reviewRoutes = require('./routes/reviews');
const adminRoutes = require('./routes/admin');
const pageRoutes = require('./routes/pages');
const notificationRoutes = require('./routes/notifications');
const forumRoutes = require('./routes/forum');
const adminForumRoutes = require('./routes/adminForum');

const globalData = require('./middlewares/globalData');
const errorHandler = require('./middlewares/errorHandler');
const { getAvatarUrl, getCoverUrl } = require('./utils/imageUrls');
const { truncateText, pluralizeRu, formatRuCount } = require('./utils/textUtils');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const enableSchemaSync = process.env.DB_SYNC_ALTER === 'true';
const HOME_PAGE_TITLE = 'Главная';

if (isProduction) app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', './views');
app.use(expressLayouts);
app.set('layout', 'layouts/main');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static('public'));

app.use(session({
  secret: process.env.SESSION_SECRET || 'house',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24,
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax'
  }
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Слишком много запросов с вашего IP. Попробуйте через 15 минут.',
  standardHeaders: true,
  legacyHeaders: false
});

app.use(flash());
app.use((req, res, next) => {
  res.locals.success_msg = req.flash('success');
  res.locals.error_msg = req.flash('error');
  res.locals.user = req.session.user || null;
  res.locals.getAvatarUrl = getAvatarUrl;
  res.locals.getCoverUrl = getCoverUrl;
  res.locals.truncateText = truncateText;
  res.locals.pluralizeRu = pluralizeRu;
  res.locals.formatRuCount = formatRuCount;
  next();
});

app.use(globalData);

app.use('/auth/forgot-password', authLimiter);
app.use('/auth/reset-password', authLimiter);

app.use('/auth', authRoutes);
app.use('/books', bookRoutes);
app.use('/profile', profileRoutes);
app.use('/admin', adminRoutes);
app.use('/reviews', reviewRoutes);
app.use('/notifications', notificationRoutes);
app.use('/forum', forumRoutes);
app.use('/admin/forum', adminForumRoutes);
app.use('/', pageRoutes);

app.get('/api/home/community-activity', async (req, res) => {
  try {
    const activity = await getCommunityActivity();
    res.json({ activity });
  } catch (error) {
    console.error('Ошибка при загрузке активности сообщества:', error);
    res.status(500).json({ activity: [] });
  }
});

const EMPTY_HOME_PAGE_DATA = {
  bookOfDay: null,
  discussedTopics: [],
  weeklyTopReviews: [],
  communityActivity: [],
  personal: null
};

const renderHomePage = (req, res, stats, homeData = EMPTY_HOME_PAGE_DATA) => res.render('index', {
  title: HOME_PAGE_TITLE,
  stats,
  homeData
});

app.get('/', async (req, res) => {
  try {
    const [stats, homeData] = await Promise.all([
      getSiteStats(),
      getHomePageData(req.session.user?.id)
    ]);
    renderHomePage(req, res, stats, homeData);
  } catch (error) {
    console.error('Ошибка при загрузке главной страницы:', error);
    renderHomePage(req, res, EMPTY_STATS);
  }
});

app.use(errorHandler.notFound);
app.use(errorHandler.errorHandler);



const ensureCompatibilityColumns = async () => {
  const queryInterface = sequelize.getQueryInterface();

  const checks = [
    { table: 'Books', attribute: 'cover_public_id', definition: { type: DataTypes.STRING, allowNull: true } },
    { table: 'Users', attribute: 'avatar_public_id', definition: { type: DataTypes.STRING, allowNull: true } },
    { table: 'Users', attribute: 'admin_appointed_at', definition: { type: DataTypes.DATE, allowNull: true } },
    { table: 'Users', attribute: 'admin_appointed_by', definition: { type: DataTypes.INTEGER, allowNull: true } },
    { table: 'Users', attribute: 'admin_appointment_reason', definition: { type: DataTypes.TEXT, allowNull: true } }
  ];

  for (const { table, attribute, definition } of checks) {
    const tableDescription = await queryInterface.describeTable(table);

    if (!tableDescription[attribute]) {
      await queryInterface.addColumn(table, attribute, definition);
      console.warn(`Добавлена отсутствующая колонка ${table}.${attribute} для совместимости схемы.`);
    }
  }
};



const ensureEmailChangeRequestsTable = async () => {
  const queryInterface = sequelize.getQueryInterface();
  const allTablesRaw = await queryInterface.showAllTables();
  const allTables = allTablesRaw.map((table) => (typeof table === 'string' ? table : table.tableName));

  if (!allTables.includes('email_change_requests')) {
    await queryInterface.createTable('email_change_requests', {
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      current_email: { type: DataTypes.STRING(254), allowNull: false },
      new_email: { type: DataTypes.STRING(254), allowNull: false },
      reason: { type: DataTypes.TEXT, allowNull: false },
      status: { type: DataTypes.ENUM('pending', 'approved', 'rejected'), allowNull: false, defaultValue: 'pending' },
      admin_note: { type: DataTypes.TEXT, allowNull: true },
      resolved_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      resolved_at: { type: DataTypes.DATE, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') },
      updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') }
    });

    await queryInterface.addIndex('email_change_requests', ['user_id', 'status']);
    await queryInterface.addIndex('email_change_requests', ['status']);

    console.warn('Создана отсутствующая таблица email_change_requests для совместимости схемы.');
  }
};

const startServer = async () => {
  try {
    await sequelize.authenticate();
    await ensureCompatibilityColumns();
    await ensureEmailChangeRequestsTable();

    if (!isProduction && enableSchemaSync) {
      await sequelize.sync({ alter: true });
    }

    app.listen(PORT, () => {
      console.log(`Сервер запущен на http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Ошибка запуска приложения:', error);
    process.exitCode = 1;
  }
};

startServer();
