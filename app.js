// app.js
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const expressLayouts = require('express-ejs-layouts');
const sequelize = require('./config/database');

// Импортируем все модели (чтобы Sequelize знал о них)
const User = require('./models/User');
const Genre = require('./models/Genre');
const Book = require('./models/Book');
const Review = require('./models/Review');
const UserBook = require('./models/UserBook');
const ReviewLike = require('./models/ReviewLike');

// Импортируем маршруты
const authRoutes = require('./routes/auth');
const bookRoutes = require('./routes/books');

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

// Middleware для статических файлов
app.use(express.static('public'));

// Настройка сессий
app.use(session({
  secret: process.env.SESSION_SECRET || 'my-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24,
    httpOnly: true,
    secure: false
  }
}));

// Flash-сообщения
app.use(flash());

// Своя middleware для передачи данных в шаблоны
app.use((req, res, next) => {
  res.locals.success_msg = req.flash('success');
  res.locals.error_msg = req.flash('error');
  res.locals.user = req.session.user || null;
  next();
});

// Подключаем маршруты
app.use('/auth', authRoutes);
app.use('/books', bookRoutes);

// Главная страница
app.get('/', (req, res) => {
  res.render('index', { 
    title: 'Главная',
    layout: 'layouts/main'
  });
});

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