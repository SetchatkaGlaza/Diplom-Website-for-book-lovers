'use strict';

const express = require('express');

module.exports = function homeRoutes({ models } = {}) {
  const router = express.Router();

  router.get('/', async (req, res, next) => {
    try {
      // Для героя берём реальные книги: витрина из настоящих обложек
      // убеждает лучше, чем нарисованный макет. Если каталог недоступен,
      // полка просто не показывается — главная не падает.
      let shelf = [];
      try {
        if (models && models.Book) {
          const books = await models.Book.findAll({
            where: { isPublished: true },
            attributes: ['slug', 'title', 'author'],
            order: [['ratingsCount', 'DESC'], ['id', 'ASC']],
            limit: 7
          });
          shelf = books.map((book) => ({ slug: book.slug, title: book.title, author: book.author }));
        }
      } catch (error) {
        req.log && req.log.warn && req.log.warn({ err: error }, 'home: полка недоступна');
      }

      res.render('home/index', {
        title: null,
        description: 'Читательский дневник с характером: полка, прогресс чтения, статистика, рецензии и клубы. Без продажи книг и полных текстов.',
        shelf
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Витрина дизайн-системы: один экран, где видно все компоненты.
   * Нужна, чтобы проверять стиль глазами на телефоне и на компьютере,
   * не собирая ради этого отдельную страницу.
   */
  router.get('/stil', (req, res) => {
    res.render('home/styleguide', {
      title: 'Витрина стилей',
      description: 'Все элементы оформления сайта на одной странице: цвета, шрифты, кнопки, карточки, формы.',
      bodyClass: 'page-styleguide'
    });
  });

  return router;
};
