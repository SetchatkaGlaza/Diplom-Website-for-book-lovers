'use strict';

const express = require('express');

module.exports = function homeRoutes() {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.render('home/index', {
      title: null,
      description: 'Читательский дневник с характером: полка, прогресс чтения, статистика, рецензии и клубы. Без продажи книг и полных текстов.'
    });
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
