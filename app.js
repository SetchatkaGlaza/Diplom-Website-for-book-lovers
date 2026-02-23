// Загружаем переменные окружения
require('dotenv').config();

// Подключение express
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const expressLayouts = require('express-ejs-layouts');

//Импортируем модели
const { sequelize, User, Genre, Book, Review, UserBook, ReviewLike } = require('./models');

// Импортируем маршруты
const authRoutes = require('./routes/auth');

// Создаем приложение
const app = express();

// Укащываем порт, на котором будет работать сервер
const PORT = process.env.PORT || 3000;

// Настройка шаблонизатора EJS
app.set('view engine','ejs');
app.set('views', './views');

app.use(expressLayouts);
app.set('layout', 'layouts/main');

// Middleware для парсинга JSON (обработки данных из форм)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware для статических файлов (CSS, JS, picture)
app.use(express.static('public'));

// Настройка сессии
app.use(session({
  secret: process.env.SESSION_SECRET || 'my-secret-key', // Ключ для шифрования
  resave: false, // не сохранять сессию, если ничего не изменилось
  saveUninitialized: false, // не создавать сессию для анонимных пользователей
  cookie: {
    maxAge: 1000 * 60 * 60 * 24, // сколько живет куки (1 день)
    httpOnly: true, // защита от XSS-атак
    secure: false // true только для HTTPS
  }
}));

// Flash-сообщения (для уведомлений)
app.use(flash());

// Своя Middleware для передачи flash-сообщений во все шаблоны
app.use((req, res, next) => {
  res.locals.success_msg = req.flash('success');
  res.locals.error_msg = req.flash('error');
  res.locals.user = req.session.user || null; // для шаблонов: есть ли пользователь
  next();
});

// Подключаем маршруты
app.use('/auth', authRoutes); // все маршрукты auth будут начитатся с /auth

// Главная страница
app.get('/', (req, res) => {
  res.render('index', {
    title: 'Главная',
    user: req.session.user || null 
  });
});

// Проверка подключения и синхронизация
const startServer = async () => {
  try {
    await sequelize.authenticate();
    console.log('Подключение с БД установлено');
    
    //Синхронизируем модели с БД
    await sequelize.sync({alter: true});
    console.log('Таблицы синхронизированы');

// Запуск сервера
app.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`);
});
  } catch (error) {
    console.error('Ошибка: ', error);
  }
};

startServer();