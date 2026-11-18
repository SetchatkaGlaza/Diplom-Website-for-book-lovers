'use strict';

const express = require('express');
const v = require('../lib/validate');
const { HttpError } = require('../lib/errors');
const { emailHash } = require('../services/digest');

/**
 * Настройки аккаунта: профиль, пароль, выгрузка данных, удаление.
 *
 * Удаление требует ввода пароля и подтверждения словом — иначе один
 * случайный клик по чужому открытому ноутбуку уничтожит дневник.
 */
module.exports = function accountRoutes({ models, services, auth }) {
  const router = express.Router();
  const { authService } = services;

  router.get('/nastroyki', auth.requireAuth, async (req, res, next) => {
    try {
      const user = await models.User.findByPk(req.currentUser.id);
      return res.render('account/settings', {
        title: 'Настройки',
        description: 'Настройки профиля и аккаунта.',
        profile: user.toPublicJSON(),
        email: user.email,
        emailVerified: Boolean(user.emailVerifiedAt),
        notifyDigest: Boolean(user.notifyDigest),
        privacy: {
          isPrivate: Boolean(user.isPrivate),
          notifyFollows: Boolean(user.notifyFollows),
          notifyComments: Boolean(user.notifyComments),
          notifyLikes: Boolean(user.notifyLikes),
          notifyMessages: Boolean(user.notifyMessages)
        },
        errors: {},
        formData: {}
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/nastroyki/profil', auth.requireAuth, async (req, res, next) => {
    try {
      const name = v.name(req.body.name);
      const bio = v.text(req.body.bio, { max: 500, field: 'О себе' });

      const errors = {};
      if (name.error) errors.name = name.error;
      if (bio.error) errors.bio = bio.error;

      if (Object.keys(errors).length) {
        const user = await models.User.findByPk(req.currentUser.id);
        return res.status(422).render('account/settings', {
          title: 'Настройки',
          description: 'Настройки профиля и аккаунта.',
          profile: user.toPublicJSON(),
          email: user.email,
          emailVerified: Boolean(user.emailVerifiedAt),
        notifyDigest: Boolean(user.notifyDigest),
          privacy: {
            isPrivate: Boolean(user.isPrivate),
            notifyFollows: Boolean(user.notifyFollows),
            notifyComments: Boolean(user.notifyComments),
            notifyLikes: Boolean(user.notifyLikes),
            notifyMessages: Boolean(user.notifyMessages)
          },
          errors,
          formData: { name: req.body.name, bio: req.body.bio }
        });
      }

      await models.User.update(
        { name: name.value, bio: bio.value },
        { where: { id: req.currentUser.id } }
      );
      auth.invalidate(req.currentUser.id);

      req.flash('success', 'Профиль обновлён');
      return res.redirect(303, '/nastroyki');
    } catch (error) {
      return next(error);
    }
  });

  /**
   * Приватность и уведомления. Галочки в форме значат «присылать»,
   * поэтому отсутствие поля в запросе — это «выключено».
   */
  router.post('/nastroyki/privatnost', auth.requireAuth, async (req, res, next) => {
    try {
      const flag = (name) => req.body[name] === '1' || req.body[name] === 'on' || req.body[name] === true;

      await models.User.update(
        {
          isPrivate: flag('isPrivate'),
          notifyFollows: flag('notifyFollows'),
          notifyComments: flag('notifyComments'),
          notifyLikes: flag('notifyLikes'),
          notifyMessages: flag('notifyMessages')
        },
        { where: { id: req.currentUser.id } }
      );

      req.flash('success', 'Настройки приватности сохранены');
      return res.redirect(303, '/nastroyki');
    } catch (error) {
      return next(error);
    }
  });

  // --- настройка писем в профиле ---
  router.post('/nastroyki/rassylka', auth.requireAuth, async (req, res, next) => {
    try {
      const user = await models.User.findByPk(req.currentUser.id);
      const enabled = req.body.notifyDigest === '1' || req.body.notifyDigest === 'on';

      if (enabled && !user.emailVerifiedAt) {
        req.flash('error', 'Сначала подтвердите адрес — на неподтверждённый адрес мы не пишем');
        return res.redirect(303, '/nastroyki');
      }

      await models.User.update({ notifyDigest: enabled }, { where: { id: user.id } });
      // Включил обратно — значит, отписка больше не действует
      if (enabled) await models.EmailUnsubscribe.destroy({ where: { emailHash: emailHash(user.email) } });

      req.flash('success', enabled
        ? 'Будем присылать письмо раз в неделю. Отписаться можно в один клик'
        : 'Письма отключены');
      return res.redirect(303, '/nastroyki');
    } catch (error) {
      return next(error);
    }
  });

  router.post('/nastroyki/parol', auth.requireAuth, async (req, res, next) => {
    try {
      const user = await models.User.findByPk(req.currentUser.id);
      const current = String(req.body.current_password || '');
      const next_ = v.passwordPair(req.body.password, req.body.password_confirm);

      const ok = await authService.verifyPassword(current, user.passwordHash);
      if (!ok) {
        req.flash('error', 'Текущий пароль неверен');
        return res.redirect(303, '/nastroyki');
      }
      if (next_.error) {
        req.flash('error', next_.error);
        return res.redirect(303, '/nastroyki');
      }

      await authService.changePassword(user, next_.value);
      // Пароль сменили — сессии на других устройствах должны умереть,
      // поэтому просим войти заново и здесь тоже.
      await auth.signOut(req);
      req.flash('success', 'Пароль изменён. Войдите с новым паролем.');
      return res.redirect(303, '/vhod');
    } catch (error) {
      return next(error);
    }
  });

  /** Выгрузка своих данных: право пользователя на экспорт. */
  router.get('/nastroyki/dannye.json', auth.requireAuth, async (req, res, next) => {
    try {
      const userId = req.currentUser.id;
      const [user, shelf, reviews] = await Promise.all([
        models.User.findByPk(userId),
        models.LibraryEntry.findAll({ where: { userId }, include: [{ model: models.Book, as: 'book' }] }),
        models.Review.findAll({ where: { userId }, include: [{ model: models.Book, as: 'book' }] })
      ]);

      res.setHeader('Content-Disposition', `attachment; filename="knigomany-${userId}.json"`);
      return res.json({
        exportedAt: new Date().toISOString(),
        profile: user.toPublicJSON(),
        email: user.email,
        shelf: shelf.map((entry) => ({
          title: entry.book?.title,
          author: entry.book?.author,
          status: entry.status,
          progressPages: entry.progressPages,
          startedAt: entry.startedAt,
          finishedAt: entry.finishedAt
        })),
        reviews: reviews.map((review) => ({
          book: review.book?.title,
          rating: review.getStars(),
          title: review.title,
          body: review.body
        }))
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/nastroyki/udalit', auth.requireAuth, async (req, res, next) => {
    try {
      const user = await models.User.findByPk(req.currentUser.id);
      const password = String(req.body.current_password || '');
      const confirmation = String(req.body.confirm || '').trim().toUpperCase();

      if (confirmation !== 'УДАЛИТЬ') {
        req.flash('error', 'Для удаления введите слово УДАЛИТЬ');
        return res.redirect(303, '/nastroyki');
      }

      const ok = await authService.verifyPassword(password, user.passwordHash);
      if (!ok) {
        req.flash('error', 'Пароль неверен — аккаунт не удалён');
        return res.redirect(303, '/nastroyki');
      }

      await authService.deleteAccount(user.id);
      await auth.signOut(req);
      req.flash('success', 'Аккаунт удалён. Спасибо, что были с нами.');
      return res.redirect(303, '/');
    } catch (error) {
      return next(error);
    }
  });

  return router;
};
