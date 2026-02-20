// Загружаем переменные окружения
require('dotenv').config();

// Подключение к базе данных
const sequelize = require('./config/database');

// Подключение express
const express = require('express');

//Импортируем модели
const User = require('./models/User');

// Создаем приложение
const app = express();

// Укащываем порт, на котором будет работать сервер
const PORT = process.env.PORT || 3000;

// Проверка подключения и синхронизация
const startServer = async () => {
  try {
    await sequelize.authenticate();
    console.log('Подключение с БД установлено');
    
    //Синхронизируем модели с БД
    await sequelize.sync({alter: true});
    console.log('Таблицы синхронизированы');

// Обработка GET-запроса к главной странице
app.get('/',  (req, res) => {
    res.send('<h1>Сайт для книгоманов(БД подключена)</h1>');
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`);
});
  } catch (error) {
    console.error('Ошибка: ', error);
  }
};

startServer();