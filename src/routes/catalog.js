'use strict';

const express = require('express');
const v = require('../lib/validate');
const { HttpError } = require('../lib/errors');
const { SORTS, DEFAULT_SORT } = require('../services/catalog');

/**
 * Каталог книг.
 *
 * Адреса:
 *   /knigi                      — список с поиском, жанром и сортировкой
 *   /knigi/novaya               — форма «добавить книгу» (нужен вход)
 *   /knigi/:slug                — карточка книги
 *   /knigi/:slug/na-polku       — быстро положить на полку
 *
 * Важно: /knigi/novaya объявлен раньше /knigi/:slug, иначе «novaya»
 * попадёт в поиск книги по слагу и вернёт 404.
 */
module.exports = function catalogRoutes({ models, services, auth }) {
  const router = express.Router();
  const catalog = services.catalogService;
  const reviewsForBook = services.reviewService
    ? (bookId, options) => services.reviewService.listForBook(bookId, options)
    : null;

  /** Комментарии сразу ко всем рецензиям страницы — одним проходом. */
  async function loadComments(reviewService, reviewIds) {
    const result = {};
    for (const id of reviewIds) {
      result[id] = await reviewService.listComments(id);
    }
    return result;
  }

  /** Страница каталога: собирает фильтры из адреса и отдаёт в шаблон. */
  router.get('/knigi', async (req, res, next) => {
    try {
      const [result, genres] = await Promise.all([
        catalog.list({
          page: req.query.page,
          sort: req.query.sort,
          query: req.query.q,
          genre: req.query.zhanr
        }),
        catalog.genresWithCounts()
      ]);

      const activeGenre = genres.find((genre) => genre.slug === result.genreSlug) || null;

      res.render('catalog/index', {
        title: activeGenre ? `Книги: ${activeGenre.name}` : 'Каталог книг',
        description: activeGenre
          ? `Книги в жанре «${activeGenre.name}»: оценки читателей, сколько человек читают и рецензии.`
          : 'Каталог книг Книгоманов: поиск по названию и автору, жанры, оценки читателей и рецензии.',
        result,
        genres,
        activeGenre,
        sorts: Object.entries(SORTS).map(([key, value]) => ({ key, label: value.label })),
        defaultSort: DEFAULT_SORT
      });
    } catch (error) {
      return next(error);
    }
  });

  // --- добавить книгу ---
  router.get('/knigi/novaya', auth.requireAuth, async (req, res, next) => {
    try {
      const genres = await catalog.allGenres();
      res.render('catalog/new', {
        title: 'Добавить книгу',
        description: 'Добавьте книгу в каталог Книгоманов: название, автор, жанр и пара слов о ней.',
        genres,
        formData: {},
        errors: {}
      });
    } catch (error) {
      return next(error);
    }
  });

  // Лимитер берём внутри обработчика: на момент сборки роутера app.locals ещё не заполнен
  const writeLimiter = (req, res, next) => req.app.locals.limiters.write(req, res, next);

  router.post('/knigi', auth.requireAuth, writeLimiter, async (req, res, next) => {
    try {
      // Пустые необязательные поля не должны ругаться — проверяем их только если заполнены
      const filled = (field) => String(req.body[field] || '').trim().length > 0;

      const title = filled('title') ? { value: v.str(req.body.title, 255) } : { error: 'Введите название' };
      const author = filled('author') ? { value: v.str(req.body.author, 160) } : { error: 'Введите автора' };
      const year = filled('year') ? v.int(req.body.year, { min: 0, max: 2100, field: 'Год' }) : { value: null };
      const pages = filled('pages') ? v.int(req.body.pages, { min: 1, max: 50000, field: 'Страницы' }) : { value: null };
      const description = filled('description')
        ? v.text(req.body.description, { max: 4000, field: 'Описание' })
        : { value: '' };
      const publisher = filled('publisher') ? { value: v.str(req.body.publisher, 160) } : { value: null };
      const isbn = filled('isbn') ? { value: v.str(req.body.isbn, 20) } : { value: null };

      const errors = {};
      if (title.error) errors.title = title.error;
      if (author.error) errors.author = author.error;
      if (year.error) errors.year = year.error;
      if (pages.error) errors.pages = pages.error;
      if (description.error) errors.description = description.error;
      if (isbn.error) errors.isbn = isbn.error;

      // Форма присылает либо несколько галочек (genres), либо одну (genre).
      // Пустое значение — это «ничего не выбрано», а не 0, поэтому отбрасываем пустые строки.
      const rawGenres = Array.isArray(req.body.genres) ? req.body.genres : [req.body.genres || req.body.genre];
      const genreIds = rawGenres
        .map((id) => Number(String(id ?? '').trim()))
        .filter((id) => Number.isInteger(id) && id > 0)
        .slice(0, 5);

      if (!genreIds.length) errors.genres = 'Выберите хотя бы один жанр';
      if (genreIds.length) {
        const known = await models.Genre.count({ where: { id: genreIds } });
        if (known !== genreIds.length) errors.genres = 'Такого жанра нет';
      }

      if (Object.keys(errors).length) {
        const genres = await catalog.allGenres();
        return res.status(422).render('catalog/new', {
          title: 'Добавить книгу',
          description: 'Добавьте книгу в каталог Книгоманов.',
          genres,
          errors,
          formData: { ...req.body, genres: genreIds }
        });
      }

      const result = await catalog.create({
        title: title.value,
        author: author.value,
        year: year.value || null,
        pages: pages.value || null,
        description: description.value || '',
        publisher: publisher.value || null,
        isbn: isbn.value || null,
        genreIds,
        userId: req.currentUser.id
      });

      if (result.error) {
        const genres = await catalog.allGenres();
        return res.status(422).render('catalog/new', {
          title: 'Добавить книгу',
          description: 'Добавьте книгу в каталог Книгоманов.',
          genres,
          errors: { form: result.error },
          formData: req.body
        });
      }

      req.flash('success', `Книга «${result.book.title}» добавлена в каталог`);
      return res.redirect(303, `/knigi/${result.book.slug}`);
    } catch (error) {
      return next(error);
    }
  });

  // --- карточка книги ---
  router.get('/knigi/:slug', async (req, res, next) => {
    try {
      const slugCheck = v.slug(req.params.slug);
      if (slugCheck.error) return next(new HttpError(404, 'Книга не найдена'));

      const found = await catalog.findBySlug(slugCheck.value);
      if (!found) return next(new HttpError(404, 'Книга не найдена'));

      // свой статус на полке, если человек вошёл
      const shelfStatuses = [
        { key: 'want', label: 'Хочу прочитать' },
        { key: 'reading', label: 'Читаю' },
        { key: 'read', label: 'Прочитал' },
        { key: 'dnf', label: 'Бросил' }
      ];

      let onShelf = null;
      if (req.currentUser) {
        onShelf = await models.LibraryEntry.findOne({
          where: { userId: req.currentUser.id, bookId: found.book.id }
        });
      }

      const near = await catalog.similar(found.book.id, 6);

      // Рецензии: по 10 на страницу, с отметками «нравится» и комментариями
      const reviewPage = reviewsForBook
        ? await reviewsForBook(found.book.id, {
          page: req.query.stranitsa,
          viewerId: req.currentUser ? req.currentUser.id : null
        })
        : { items: [], total: 0, page: 1, pages: 0 };

      const commentsByReview = reviewPage.items.length && services.reviewService
        ? await loadComments(services.reviewService, reviewPage.items.map((item) => item.id))
        : {};

      // Подборки, в которые входит книга: связывают карточку с редакционными списками
      const inCollections = services.contentService
        ? await services.contentService.collectionsForBook(found.book.id)
        : [];

      const quotes = services.socialService
        ? await services.socialService.listQuotesForBook(found.book.id, { limit: 10 })
        : [];

      const ownReview = req.currentUser && services.reviewService
        ? await services.reviewService.ownReview(req.currentUser.id, found.book.id)
        : null;

      // Просмотры считаем, но не ждём результата: страница не должна ждать ещё один запрос
      catalog.countView(found.book.id).catch(() => {});

      res.render('catalog/book', {
        title: found.book.title,
        description: buildDescription(found.book),
        book: found.book,
        genres: found.genres,
        counts: found.counts,
        reviews: reviewPage,
        commentsByReview,
        quotes,
        ownReview,
        onShelf: onShelf ? onShelf.get({ plain: true }) : null,
        onShelfLabel: onShelf
          ? (shelfStatuses.find((status) => status.key === onShelf.status) || {}).label || onShelf.status
          : null,
        similar: near,
        inCollections,
        shelfStatuses
      });
    } catch (error) {
      return next(error);
    }
  });

  // Старые адреса «положить на полку» ведут на маршруты полки:
  // ссылки могли сохраниться в чьих-то закладках
  router.post('/knigi/:slug/polka', auth.requireAuth, (req, res) => {
    res.redirect(307, `/polka/${encodeURIComponent(req.params.slug)}/status`);
  });
  router.post('/knigi/:slug/ubrat', auth.requireAuth, (req, res) => {
    res.redirect(307, `/polka/${encodeURIComponent(req.params.slug)}/remove`);
  });

  return router;
};

/** Описание для поисковиков: до 300 знаков, без обрывов посреди слова. */
function buildDescription(book) {
  const parts = [`${book.title} — ${book.author}`];
  if (book.year) parts.push(`${book.year} год`);
  if (book.rating) parts.push(`оценка ${book.rating} из 5`);
  const lead = String(book.description || '').replace(/\s+/g, ' ').trim();
  const head = parts.join(', ');
  if (!lead) return `${head}. Оценки и рецензии читателей на Книгоманах.`.slice(0, 300);
  const room = 300 - head.length - 2;
  return lead.length > room ? `${head}. ${lead.slice(0, Math.max(0, room - 1)).trimEnd()}…` : `${head}. ${lead}`;
}

module.exports.buildDescription = buildDescription;
