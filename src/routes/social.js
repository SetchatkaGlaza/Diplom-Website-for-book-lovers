'use strict';

const express = require('express');
const v = require('../lib/validate');
const { HttpError } = require('../lib/errors');

/**
 * Социальная часть.
 *
 *   /lenta                     — что читают люди, на которых вы подписаны
 *   /chitateli                 — поиск читателей
 *   /chitateli/:id             — публичный профиль, подписка/отписка
 *   /uvеdomleniya              — уведомления, «прочитать все»
 *   /soobshcheniya             — список диалогов
 *   /soobshcheniya/:id         — диалог, отправка сообщения
 *   /knigi/:slug/tsitata       — добавить цитату (до 300 знаков)
 *
 * Полка чужого человека видна, только если профиль открыт или вы подписаны.
 */
module.exports = function socialRoutes({ models, services, auth }) {
  const router = express.Router();
  const social = services.socialService;

  // ==================== ЛЕНТА ====================

  router.get('/lenta', auth.requireAuth, async (req, res, next) => {
    try {
      const result = await social.feed(req.currentUser.id, { page: req.query.stranitsa });
      res.render('social/feed', {
        title: 'Лента',
        description: 'Что читают люди, на которых вы подписаны: новые книги на полках, рецензии и итоги.',
        result
      });
    } catch (error) {
      return next(error);
    }
  });

  // ==================== ЛЮДИ ====================

  router.get('/chitateli', auth.requireAuth, async (req, res, next) => {
    try {
      const query = String(req.query.q || '').slice(0, 60);
      const people = await social.searchPeople(query, { limit: 30 });
      const counts = await social.counts(req.currentUser.id);

      res.render('social/people', {
        title: 'Читатели',
        description: 'Найдите читателей по имени и подпишитесь, чтобы видеть их полку и рецензии.',
        people,
        query,
        counts
      });
    } catch (error) {
      return next(error);
    }
  });

  /**
   * Публичный профиль. Приватность: имя и «о себе» видны всем вошедшим,
   * полка и рецензии — только подписчикам открытого профиля.
   */
  router.get('/chitateli/:id', auth.requireAuth, async (req, res, next) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(id) || id < 1) return next(new HttpError(404, 'Читатель не найден'));

      const person = await models.User.findOne({ where: { id, deletedAt: null } });
      if (!person) return next(new HttpError(404, 'Читатель не найден'));

      const isSelf = person.id === req.currentUser.id;
      const following = await social.isFollowing(req.currentUser.id, person.id);
      const counts = await social.counts(person.id);

      // Приватный профиль закрыт для всех, кроме самого человека и его подписчиков
      const canSeeShelf = isSelf || !person.isPrivate || following;

      let shelf = [];
      let reviews = [];
      if (canSeeShelf) {
        [shelf, reviews] = await Promise.all([
          services.shelfService.list(person.id, { limit: 12 }),
          services.reviewService
            ? models.Review.findAll({
              where: { userId: person.id, state: 'published' },
              include: [{ association: 'book', attributes: ['slug', 'title', 'author'] }],
              order: [['createdAt', 'DESC']],
              limit: 5
            })
            : []
        ]);
      }

      res.render('social/profile', {
        title: `${person.name} — читатель`,
        description: `${person.name} на Книгоманах: полка чтения, оценки и рецензии.`,
        person: {
          id: person.id,
          name: person.name,
          bio: person.bio || '',
          isPrivate: person.isPrivate,
          createdAt: person.createdAt
        },
        isSelf,
        following,
        canSeeShelf,
        counts,
        shelf,
        reviews: reviews.map((review) => ({
          id: review.id,
          title: review.title || '',
          rating: review.getStars ? review.getStars() : 0,
          body: String(review.body || '').slice(0, 240),
          book: review.book ? { slug: review.book.slug, title: review.book.title } : null
        }))
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/chitateli/:id/podpiska', auth.requireAuth, async (req, res, next) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return next(new HttpError(404, 'Читатель не найден'));

      // Если подписка уже есть — кнопка работает как «отписаться»
      const following = await social.isFollowing(req.currentUser.id, id);
      const result = following
        ? await social.unfollow({ followerId: req.currentUser.id, followingId: id })
        : await social.follow({ followerId: req.currentUser.id, followingId: id });

      if (result.error) {
        req.flash('error', result.error);
      } else {
        req.flash('success', result.following ? 'Вы подписались' : 'Вы отписались');
      }

      return res.redirect(303, `/chitateli/${id}`);
    } catch (error) {
      return next(error);
    }
  });

  // ==================== УВЕДОМЛЕНИЯ ====================

  router.get('/uvedomleniya', auth.requireAuth, async (req, res, next) => {
    try {
      const items = await social.listNotifications(req.currentUser.id);
      res.render('social/notifications', {
        title: 'Уведомления',
        description: 'Что произошло на сайте: подписки, комментарии, лайки и сообщения.',
        items
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/uvedomleniya/prochitat', auth.requireAuth, async (req, res, next) => {
    try {
      await social.markAllRead(req.currentUser.id);
      return res.redirect(303, '/uvedomleniya');
    } catch (error) {
      return next(error);
    }
  });

  // ==================== СООБЩЕНИЯ ====================

  router.get('/soobshcheniya', auth.requireAuth, async (req, res, next) => {
    try {
      const list = await social.conversations(req.currentUser.id);
      res.render('social/messages', {
        title: 'Сообщения',
        description: 'Личные сообщения с другими читателями.',
        conversations: list
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/soobshcheniya/:id', auth.requireAuth, async (req, res, next) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return next(new HttpError(404, 'Диалог не найден'));

      const result = await social.conversationMessages(req.currentUser.id, id);
      if (result.error) return next(new HttpError(404, result.error));

      // Открыл диалог — входящие прочитаны
      await social.markConversationRead(req.currentUser.id, id);

      res.render('social/conversation', {
        title: `Диалог с ${result.conversation.other.name}`,
        description: 'Личная переписка на Книгоманах.',
        conversation: result.conversation,
        messages: result.messages
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/soobshcheniya', auth.requireAuth, async (req, res, next) => {
    try {
      const recipientId = Number.parseInt(req.body.recipient, 10);
      if (!Number.isFinite(recipientId)) return next(new HttpError(422, 'Получатель не найден'));

      const result = await social.sendMessage({
        senderId: req.currentUser.id,
        recipientId,
        body: req.body.body
      });

      if (result.error) {
        req.flash('error', result.error);
        return res.redirect(303, `/chitateli/${recipientId}`);
      }

      return res.redirect(303, `/soobshcheniya/${result.conversation.id}`);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/soobshcheniya/:id', auth.requireAuth, async (req, res, next) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return next(new HttpError(404, 'Диалог не найден'));

      const result = await social.sendMessage({
        senderId: req.currentUser.id,
        conversationId: id,
        body: req.body.body
      });

      if (result.error) {
        req.flash('error', result.error);
        return res.redirect(303, `/soobshcheniya/${id}`);
      }
      return res.redirect(303, `/soobshcheniya/${id}`);
    } catch (error) {
      return next(error);
    }
  });

  // ==================== ЦИТАТЫ ====================

  router.post('/knigi/:slug/tsitata', auth.requireAuth, async (req, res, next) => {
    try {
      const check = v.slug(req.params.slug);
      if (check.error) return next(new HttpError(404, 'Книга не найдена'));

      const book = await models.Book.findOne({ where: { slug: check.value } });
      if (!book) return next(new HttpError(404, 'Книга не найдена'));

      const result = await social.addQuote({
        userId: req.currentUser.id,
        bookId: book.id,
        body: req.body.body,
        page: req.body.page
      });

      if (result.error) {
        req.flash('error', result.error);
      } else {
        req.flash('success', 'Цитата сохранена');
      }
      return res.redirect(303, `/knigi/${book.slug}#tsitaty`);
    } catch (error) {
      return next(error);
    }
  });

  return router;
};
