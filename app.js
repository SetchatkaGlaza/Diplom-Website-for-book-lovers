// Подключение express
const express = require('express');

// Создаем приложение
const app = express();

// Укащываем порт, на котором будет работать сервер
const PORT = 3000;

// Обработка GET-запроса к главной странице
app.get('/',  (req, res) => {
    res.send('<h1>Сайт для книгоманов</h1>');
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`);
});