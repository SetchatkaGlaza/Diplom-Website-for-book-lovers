require('dotenv').config({ quiet: true });
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const expressLayouts = require('express-ejs-layouts');
const methodOverride = require('method-override');
const rateLimit = require('express-rate-limit');

const sequelize = require('./config/database');
const { User, Book, Review } = require('./models');

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

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const enableSchemaSync = process.env.DB_SYNC_ALTER === 'true';

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
  next();
});

app.use(globalData);

app.use('/auth/login', authLimiter);
app.use('/auth/register', authLimiter);
app.use('/auth/forgot-password', authLimiter);

app.use('/auth', authRoutes);
app.use('/books', bookRoutes);
app.use('/profile', profileRoutes);
app.use('/admin', adminRoutes);
app.use('/reviews', reviewRoutes);
app.use('/notifications', notificationRoutes);
app.use('/forum', forumRoutes);
app.use('/admin/forum', adminForumRoutes);
app.use('/', pageRoutes);

app.get('/', async (req, res) => {
  try {
    const [totalBooks, totalUsers, totalReviews] = await Promise.all([
      Book.count(),
      User.count(),
      Review.count()
    ]);

    res.render('index', {
      title: 'Главная',
      layout: 'layouts/main',
      stats: { totalBooks, totalUsers, totalReviews }
    });
  } catch (error) {
    console.error('Ошибка при загрузке главной страницы:', error);
    res.render('index', {
      title: 'Главная',
      layout: 'layouts/main',
      stats: { totalBooks: 0, totalUsers: 0, totalReviews: 0 }
    });
  }
});

app.use(errorHandler.notFound);
app.use(errorHandler.errorHandler);

const startServer = async () => {
  try {
    await sequelize.authenticate();

    if (!isProduction && enableSchemaSync) {
      await sequelize.sync({ alter: true });
    }

    app.listen(PORT, () => {
      console.log(`Сервер запущен на http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('❌ Ошибка запуска приложения:', error);
    process.exitCode = 1;
  }
};

startServer();
