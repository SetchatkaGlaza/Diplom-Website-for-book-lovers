const express = require('express');
const router = express.Router();
const bookController = require('../controllers/bookController');

router.get('/', bookController.getCatalog);

router.get('/search', bookController.searchBooks);

router.get('/popular', bookController.getPopularBooks);

router.get('/random', bookController.getRandomBook);

router.get('/:id', bookController.getBookById);

module.exports = router;
