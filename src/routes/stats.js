'use strict';

const express = require('express');
const { HttpError } = require('../lib/errors');
const { renderYearCard, SIZES } = require('../services/poster');

/**
 * Статистика читателя и «Книжный год».
 *
 * Свои цифры видит любой автор дневника. Чужие — только если профиль открыт
 * или вы подписаны: статистика выдаёт привычки чтения, это личное.
 */
module.exports = function statsRoutes({ models, services, auth }) {
  const router = express.Router();
  const { statsService, socialService } = services;

  /** Можно ли смотреть статистику этого человека. */
  async function canView(personId, viewer) {
    if (viewer && viewer.id === personId) return true;
    if (!viewer) return false;
    const person = await models.User.findByPk(personId, { attributes: ['id', 'isPrivate'] });
    if (!person) return false;
    if (!person.isPrivate) return true;
    return socialService.isFollowing(viewer.id, personId);
  }

  async function loadPerson(req) {
    const person = await models.User.findByPk(req.params.id, {
      attributes: ['id', 'name', 'isPrivate', 'avatar']
    });
    if (!person) throw new HttpError(404, 'Читатель не найден');
    return person;
  }

  // Своя статистика
  router.get('/statistika', auth.requireAuth, async (req, res, next) => {
    try {
      const year = Number(req.query.god) || new Date().getFullYear();
      const [totals, genres, months, map, achievements] = await Promise.all([
        statsService.summary({ userId: req.currentUser.id, year }),
        statsService.topGenres(req.currentUser.id, year),
        statsService.byMonth(req.currentUser.id, year),
        statsService.activityMap(req.currentUser.id, year),
        statsService.achievements(req.currentUser.id, year)
      ]);

      return res.render('stats/index', {
        title: 'Статистика',
        description: 'Сколько книг и страниц прочитано, темп чтения, любимые жанры и карта года.',
        year,
        totals,
        genres,
        months,
        map,
        achievements,
        person: req.currentUser
      });
    } catch (error) {
      return next(error);
    }
  });

  // Чужая статистика — с проверкой приватности
  router.get('/chitateli/:id/statistika', auth.requireAuth, async (req, res, next) => {
    try {
      const person = await loadPerson(req);
      if (!(await canView(person.id, req.currentUser))) {
        throw new HttpError(403, 'Статистика этого читателя закрыта');
      }

      const year = Number(req.query.god) || new Date().getFullYear();
      const [totals, genres, months, map] = await Promise.all([
        statsService.summary({ userId: person.id, year }),
        statsService.topGenres(person.id, year),
        statsService.byMonth(person.id, year),
        statsService.activityMap(person.id, year)
      ]);

      return res.render('stats/index', {
        title: `Статистика: ${person.name}`,
        description: `Читательские итоги ${person.name} за ${year} год.`,
        year,
        totals,
        genres,
        months,
        map,
        achievements: [],
        person
      });
    } catch (error) {
      return next(error);
    }
  });

  // «Книжный год» — итоговая страница
  router.get('/knizhnyy-god', auth.requireAuth, async (req, res, next) => {
    try {
      const year = Number(req.query.god) || new Date().getFullYear();
      const data = await statsService.yearInBooks(req.currentUser.id, year);
      const achievements = await statsService.achievements(req.currentUser.id, year);
      const years = await yearsWithData(req.currentUser.id, year);

      return res.render('stats/year', {
        title: `Книжный год: ${year}`,
        description: `Итоги чтения за ${year} год: книги, страницы, жанры и карта активности.`,
        data,
        achievements,
        years,
        person: req.currentUser
      });
    } catch (error) {
      return next(error);
    }
  });

  // Скачивание карточки: ?format=story (1080×1350) или ?format=square (1080×1080)
  router.get('/knizhnyy-god/kartinka', auth.requireAuth, async (req, res, next) => {
    try {
      const year = Number(req.query.god) || new Date().getFullYear();
      const format = req.query.format === 'square' ? 'square' : 'story';
      const data = await statsService.yearInBooks(req.currentUser.id, year);

      const card = await renderYearCard({
        year: data.year,
        name: req.currentUser.name,
        books: data.totals.booksRead,
        pages: data.totals.pagesRead,
        reviews: data.totals.reviews,
        streak: data.totals.longestStreak,
        genres: data.genres
      }, { size: format });

      res.set('Content-Type', 'image/png');
      res.set('Content-Disposition', `inline; filename="knizhnyy-god-${year}-${format}.png"`);
      res.set('Cache-Control', 'private, max-age=3600');
      return res.send(card.buffer);
    } catch (error) {
      return next(error);
    }
  });

  /** Годы, за которые есть хоть одна закрытая книга — для переключателя. */
  async function yearsWithData(userId, fallback) {
    const rows = await models.LibraryEntry.findAll({
      attributes: ['finishedAt'],
      where: { userId, status: 'read' },
      raw: true
    });

    const years = new Set(rows
      .filter((row) => row.finishedAt)
      .map((row) => new Date(row.finishedAt).getUTCFullYear()));

    years.add(new Date().getFullYear());
    years.add(Number(fallback) || new Date().getFullYear());

    return [...years].sort((a, b) => b - a);
  }

  return router;
};

module.exports.SIZES = SIZES;
