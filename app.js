require('dotenv').config();
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const expressLayouts = require('express-ejs-layouts');
const methodOverride = require('method-override');
const path = require('path');
const sequelize = require('./config/database');
const rateLimit = require('express-rate-limit');

// Импортируем все модели
const { User, Genre, Book, Review, UserBook, ReviewLike } = require('./models');

if (process.env.NODE_ENV === 'production') {
  require('./scripts/run-seed-on-startup');
}

// Импортируем маршруты
const authRoutes = require('./routes/auth');
const bookRoutes = require('./routes/books');
const profileRoutes = require('./routes/profile');
const reviewRoutes = require('./routes/reviews');
const adminRoutes = require('./routes/admin');
const globalData = require('./middlewares/globalData');
const pageRoutes = require('./routes/pages');
const notificationRoutes = require('./routes/notifications');
const forumRoutes = require('./routes/forum');
const adminForumRoutes = require('./routes/adminForum');
const errorHandler = require('./middlewares/errorHandler');

const app = express();
const PORT = process.env.PORT || 3000;

// Настройка шаблонизатора EJS с layout
app.set('view engine', 'ejs');
app.set('views', './views');
app.use(expressLayouts);
app.set('layout', 'layouts/main'); // основной макет по умолчанию

// Middleware для обработки данных из форм
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));

// Middleware для статических файлов
app.use(express.static('public'));

// Явная раздача favicon для хостинга, где браузер запрашивает /favicon.ico
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'images', 'icons', 'favicon.ico'));
});

// Настройка сессий
app.use(session({
  secret: process.env.SESSION_SECRET || 'house',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24,
    httpOnly: true,
    secure: false
  }
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 10, // максимум 10 запросов с одного IP
  message: 'Слишком много запросов с вашего IP. Попробуйте через 15 минут.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Flash-сообщения
app.use(flash());

// Своя middleware для передачи данных в шаблоны
app.use((req, res, next) => {
  res.locals.success_msg = req.flash('success');
  res.locals.error_msg = req.flash('error');
  res.locals.user = req.session.user || null;
  next();
});

// Глобальные данные (статистика для подвала и т.д.)
app.use(globalData);

// ===== ПОДКЛЮЧАЕМ ВСЕ МАРШРУТЫ =====
app.use('/auth', authRoutes);
app.use('/auth/login', authLimiter);
app.use('/auth/register', authLimiter);
app.use('/auth/forgot-password', authLimiter);
app.use('/books', bookRoutes);
app.use('/profile', profileRoutes);
app.use('/admin', adminRoutes);
app.use('/reviews', reviewRoutes);
app.use('/notifications', notificationRoutes);
app.use('/forum', forumRoutes);
app.use('/admin/forum', adminForumRoutes);
app.use('/', pageRoutes); // Статические страницы (about, faq, rules, contact)

// ===== ГЛАВНАЯ СТРАНИЦА =====
app.get('/', async (req, res) => {
  try {
    // Получаем реальную статистику из базы данных
    const totalBooks = await Book.count();
    const totalUsers = await User.count();
    const totalReviews = await Review.count();
    
    res.render('index', { 
      title: 'Главная',
      layout: 'layouts/main',
      stats: {
        totalBooks,
        totalUsers,
        totalReviews
      }
    });
  } catch (error) {
    console.error('Ошибка при загрузке главной страницы:', error);
    res.render('index', { 
      title: 'Главная',
      layout: 'layouts/main',
      stats: {
        totalBooks: 0,
        totalUsers: 0,
        totalReviews: 0
      }
    });
  }
});

// ===== ОБРАБОТКА ОШИБОК (ДОЛЖНА БЫТЬ В САМОМ КОНЦЕ) =====
app.use(errorHandler.notFound);
app.use(errorHandler.errorHandler);

// Запуск сервера с синхронизацией БД
const startServer = async () => {
  try {
    await sequelize.authenticate();
    console.log('Подключение к базе данных прошло успешно!');

    await sequelize.sync({ alter: true }); 
    console.log('Таблицы синхронизированы');

    app.listen(PORT, () => {
      console.log(`Сервер запущен на http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('❌ Ошибка:', error);
  }
};

startServer();
