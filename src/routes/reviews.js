'use strict';

const express = require('express');
const v = require('../lib/validate');
const { HttpError } = require('../lib/errors');

/**
 * Оценки и рецензии.
 *
 *   /knigi/:slug/retsenziya        — форма (GET) и сохранение (POST)
 *   /retsenziya/:id/udalit         — удалить свою рецензию
 *   /retsenziya/:id/like           — лайк, ответ JSON для быстрой кнопки
 *   /retsenziya/:id/komment         — комментарий к рецензии
 *
 * Все изменения — только после входа. Чужую рецензию править нельзя,
 * удалить может автор или модератор.
 */
module.exports = function reviewRoutes({ models, services, auth }) {
  const router = express.Router();
  const reviews = services.reviewService;

  async function loadBook(slug) {
    const check = v.slug(slug);
    if (check.error) throw new HttpError(404, 'Книга не найдена');
    const book = await models.Book.findOne({ where: { slug: check.value } });
    if (!book) throw new HttpError(404, 'Книга не найдена');
    return book;
  }

  /** Форма: показывает уже написанную рецензию, если она есть. */
  router.get('/knigi/:slug/retsenziya', auth.requireAuth, async (req, res, next) => {
    try {
      const book = await loadBook(req.params.slug);
      const own = await reviews.ownReview(req.currentUser.id, book.id);

      res.render('reviews/form', {
        title: own ? `Рецензия на «${book.title}»` : `Написать рецензию на «${book.title}»`,
        description: `Оценка и рецензия на книгу «${book.title}»: поделитесь впечатлением без спойлеров.`,
        book,
        own,
        formData: own
          ? { rating: own.rating, title: own.title, body: own.body, hasSpoilers: own.hasSpoilers }
          : { rating: 4 },
        errors: {}
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/knigi/:slug/retsenziya', auth.requireAuth, async (req, res, next) => {
    try {
      const book = await loadBook(req.params.slug);
      const rating = v.rating(req.body.rating);
      const title = v.str(req.body.title || '', 160);
      const body = String(req.body.body || '').trim();
      const hasSpoilers = Boolean(req.body.hasSpoilers);

      const errors = {};
      if (rating.error) errors.rating = rating.error;
      if (body.length < reviews.LIMITS.REVIEW_MIN) {
        errors.body = `Рецензия: минимум ${reviews.LIMITS.REVIEW_MIN} знаков`;
      }
      if (body.length > reviews.LIMITS.REVIEW_MAX) {
        errors.body = `Рецензия: максимум ${reviews.LIMITS.REVIEW_MAX} знаков`;
      }

      // Автофильтр: ссылки у новичков, реклама, капс, повторы
      if (services.moderationService && !Object.keys(errors).length) {
        const guard = await services.moderationService.guard({
          userId: req.currentUser.id,
          text: `${title} ${body}`,
          model: models.Review,
          field: 'рецензии'
        });
        if (!guard.ok) errors.body = guard.error;
      }

      if (Object.keys(errors).some((key) => errors[key])) {
        return res.status(422).render('reviews/form', {
          title: `Рецензия на «${book.title}»`,
          description: `Оценка и рецензия на книгу «${book.title}».`,
          book,
          own: null,
          formData: { rating: req.body.rating, title, body, hasSpoilers },
          errors
        });
      }

      const result = await reviews.save({
        userId: req.currentUser.id,
        bookId: book.id,
        rating: Number(req.body.rating),
        title,
        body,
        hasSpoilers
      });

      if (result.error) return next(new HttpError(422, result.error));

      await services.shelfService.recountShelves(book.id);
      req.flash('success', result.created ? 'Рецензия опубликована' : 'Рецензия обновлена');
      return res.redirect(303, `/knigi/${book.slug}#retsenzii`);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/retsenziya/:id/udalit', auth.requireAuth, async (req, res, next) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return next(new HttpError(404, 'Рецензия не найдена'));

      const review = await models.Review.findByPk(id);
      const isModerator = ['moderator', 'admin'].includes(req.currentUser.role);
      const result = await reviews.remove({
        userId: req.currentUser.id,
        reviewId: id,
        isModerator
      });

      if (result.error) return next(new HttpError(403, result.error));

      const target = review ? `/knigi/${(await models.Book.findByPk(review.bookId))?.slug || ''}` : '/knigi';
      req.flash('info', 'Рецензия удалена');
      return res.redirect(303, target);
    } catch (error) {
      return next(error);
    }
  });

  /** Лайк отвечает JSON — кнопка обновляется без перезагрузки страницы. */
  router.post('/retsenziya/:id/like', auth.requireAuth, async (req, res, next) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return next(new HttpError(404, 'Рецензия не найдена'));

      const review = await models.Review.findByPk(id);
      const result = await reviews.toggleLike({ userId: req.currentUser.id, reviewId: id });
      if (result.error) return next(new HttpError(404, result.error));

      // Уведомляем автора рецензии, но только когда лайк поставили, а не сняли
      if (result.liked && review && review.userId !== req.currentUser.id && services.socialService) {
        const liker = req.currentUser;
        const book = await models.Book.findByPk(review.bookId);
        await services.socialService.notify({
          userId: review.userId,
          type: 'like',
          title: `${liker.name} оценил вашу рецензию`,
          body: book ? `Книга «${book.title}»` : '',
          url: book ? `/knigi/${book.slug}#review-${review.id}` : null
        });
      }

      if (req.xhr || String(req.get('accept') || '').includes('application/json')) {
        return res.json({ ok: true, liked: result.liked, likesCount: result.likesCount });
      }
      return res.redirect(303, req.body.return_to || '/knigi');
    } catch (error) {
      return next(error);
    }
  });

  router.post('/retsenziya/:id/komment', auth.requireAuth, async (req, res, next) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return next(new HttpError(404, 'Рецензия не найдена'));

      const reviewForNotify = await models.Review.findByPk(id);
      const result = await reviews.addComment({
        userId: req.currentUser.id,
        reviewId: id,
        body: req.body.body
      });

      if (!result.error && reviewForNotify && reviewForNotify.userId !== req.currentUser.id && services.socialService) {
        const book = await models.Book.findByPk(reviewForNotify.bookId);
        await services.socialService.notify({
          userId: reviewForNotify.userId,
          type: 'comment',
          title: `${req.currentUser.name} прокомментировал вашу рецензию`,
          body: String(req.body.body || '').slice(0, 120),
          url: book ? `/knigi/${book.slug}#review-${id}` : null
        });
      }

      if (result.error) {
        if (req.xhr) return res.status(422).json({ error: result.error });
        req.flash('error', result.error);
      } else {
        req.flash('success', 'Комментарий добавлен');
      }

      return res.redirect(303, safeReturn(req.body.return_to));
    } catch (error) {
      return next(error);
    }
  });

  return router;
};

function safeReturn(value) {
  const path = String(value || '');
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return '/knigi';
  return path.slice(0, 300);
}
