const express = require('express');
const router = express.Router();
const bookController = require('../controllers/bookController');
const { requireAuth } = require('../middlewares/authMiddleware');

// Публичные маршруты (доступны всем)

// GET /books - каталог книг
router.get('/', bookController.getCatalog);

// GET /books/search - поиск книг (AJAX)
router.get('/search', bookController.searchBooks);

// GET /books/popular - популярные книги (AJAX)
router.get('/popular', bookController.getPopularBooks);

// GET /books/random - случайная книга (AJAX)
router.get('/random', bookController.getRandomBook);

// GET /books/:id - страница одной книги
router.get('/:id', bookController.getBookById);

// Защищённые маршруты (только для авторизованных)
// Здесь пока пусто, добавим позже (рецензии, полки)

module.exports = router;