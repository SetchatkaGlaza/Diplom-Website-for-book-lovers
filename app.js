

// Подключение express
const express = require('express');

//Импортируем модели
const { sequelize, User, Genre, Book, Review, UserBook, ReviewLike } = require('./models');

// Создаем приложение
const app = express();

// Укащываем порт, на котором будет работать сервер
const PORT = process.env.PORT || 3000;

// Middleware для парсинга JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
    res.json({ 
        message: 'Сайт для книгоманов работает!',
        tables: ['Users', 'Genres', 'Books', 'Reviews', 'UserBooks', 'ReviewLikes']
      });
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