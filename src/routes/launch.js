'use strict';

const express = require('express');

/**
 * Публичная страница «Книжный год» — акция запуска.
 *
 * Идея простая: человек не регистрируется «на всякий случай», ему нужен
 * повод. Повод — готовая картинка с итогами чтения, которую не стыдно
 * выложить. Поэтому страница открыта гостю: он видит, как это выглядит,
 * и решает, нужен ли ему свой.
 *
 * Приватность: чужие итоги показываются без имени — только числа.
 * Свои (после входа) — с именем и кнопками скачивания.
 */
module.exports = function launchRoutes({ models, services, auth }) {
  const router = express.Router();

  router.get('/knizhnyy-god-primer', (req, res) => {
    // Пример собран из круглых чисел, а не из чьих-то реальных данных:
    // показывать чужие итоги было бы невежливо
    const example = {
      year: new Date().getFullYear(),
      booksRead: 27,
      pagesRead: 8420,
      reviews: 11,
      longestStreak: 34,
      genres: [
        { name: 'Современная проза', books: 9 },
        { name: 'Фантастика', books: 6 },
        { name: 'Нон-фикшн', books: 5 },
        { name: 'Русская классика', books: 4 },
        { name: 'Поэзия', books: 3 }
      ]
    };

    res.render('launch/year-example', {
      title: 'Книжный год: как это выглядит',
      description: 'Итоги года чтения одной картинкой: книги, страницы, серия дней и любимые жанры. Бесплатно, без рекламы и полных текстов книг.',
      example,
      isLoggedIn: Boolean(req.currentUser)
    });
  });

  return router;
};
