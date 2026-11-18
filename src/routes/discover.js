'use strict';

const express = require('express');
const { HttpError } = require('../lib/errors');
const v = require('../lib/validate');

/**
 * Навигация по контенту: подборки и авторы.
 *
 * Зачем отдельные страницы:
 *  - подборка — это ответ на вопрос «что почитать», а не список книг
 *    по алфавиту; у неё есть человеческое описание и порядок;
 *  - страница автора связывает книги между собой: читатель, которому
 *    понравился роман, обычно ищет «что у него ещё есть».
 *
 * Адреса короткие и по-русски, как и всё остальное на сайте.
 */
module.exports = function discoverRoutes({ models, services }) {
  const router = express.Router();
  const content = services.contentService;

  // --- все подборки ---
  router.get('/podborki', async (req, res, next) => {
    try {
      const collections = await content.collectionsList();
      res.render('discover/collections', {
        title: 'Подборки книг',
        description: 'Подборки Книгоманов: что читать, если давно не читал, книги на ночь, антиутопии и ещё двадцать списков с объяснением, зачем они.',
        collections
      });
    } catch (error) {
      return next(error);
    }
  });

  // --- одна подборка ---
  router.get('/podborki/:slug', async (req, res, next) => {
    try {
      const slug = v.slug(req.params.slug);
      if (slug.error) return next(new HttpError(404, 'Подборка не найдена'));

      const found = await content.collectionBySlug(slug.value);
      if (!found) return next(new HttpError(404, 'Подборка не найдена'));

      const others = (await content.collectionsList())
        .filter((item) => item.slug !== found.collection.slug)
        .slice(0, 4);

      res.render('discover/collection', {
        title: found.collection.title,
        description: `${found.collection.title}: ${found.collection.description}`.slice(0, 300),
        collection: found.collection,
        books: found.books,
        others
      });
    } catch (error) {
      return next(error);
    }
  });

  // --- авторы ---
  router.get('/avtory', async (req, res, next) => {
    try {
      const authors = await content.authorsList();
      res.render('discover/authors', {
        title: 'Авторы',
        description: 'Авторы Книгоманов: короткие биографии и все книги, которые есть в каталоге.',
        authors
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/avtory/:slug', async (req, res, next) => {
    try {
      const slug = v.slug(req.params.slug);
      if (slug.error) return next(new HttpError(404, 'Автор не найден'));

      const found = await content.authorBySlug(slug.value);
      if (!found) return next(new HttpError(404, 'Автор не найден'));

      res.render('discover/author', {
        title: found.author.name,
        description: `${found.author.name}${found.author.years ? ` (${found.author.years})` : ''}: книги в каталоге и короткая биография.`,
        author: found.author,
        books: found.books
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
};
