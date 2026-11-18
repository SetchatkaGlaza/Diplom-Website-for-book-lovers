'use strict';

const express = require('express');
const v = require('../lib/validate');
const { renderWithErrors } = require('../middlewares/form');
const { sendVerifyEmail, sendResetEmail } = require('../lib/mailer');
const { publicUrl } = require('../config/env');

/**
 * Маршруты аутентификации.
 *
 * Принципы:
 *  - все ответы на восстановление пароля одинаковые: не сообщаем,
 *    есть такой e-mail или нет;
 *  - после регистрации сессия не создаётся: сначала подтверждение почты;
 *  - любые переходы — 303, чтобы POST не повторялся при обновлении страницы.
 */
module.exports = function authRoutes({ models, services, auth }) {
  const router = express.Router();
  const { authService, tokenService } = services;
  // Один адрес сайта на всё: письма, canonical и редиректы с www
  const baseUrl = () => publicUrl();

  // --- регистрация ---
  router.get('/registratsiya', auth.guestOnly, (req, res) => {
    res.render('auth/register', {
      title: 'Регистрация',
      description: 'Создайте аккаунт в Книгоманах: полка, прогресс чтения и статистика.',
      formData: {}
    });
  });

  router.post('/registratsiya', auth.guestOnly, registerLimiter(), async (req, res, next) => {
    try {
      const email = v.email(req.body.email);
      const name = v.name(req.body.name);
      const password = v.passwordPair(req.body.password, req.body.password_confirm);

      const errors = {};
      if (email.error) errors.email = email.error;
      if (name.error) errors.name = name.error;
      if (password.error) errors.password = password.error;

      if (Object.keys(errors).length) {
        return res.status(422).render('auth/register', {
          title: 'Регистрация',
          description: 'Создайте аккаунт в Книгоманах.',
          errors,
          formData: { email: req.body.email, name: req.body.name }
        });
      }

      const result = await authService.register({
        email: email.value,
        name: name.value,
        password: password.value,
        ip: req.ip
      });

      if (result.error) {
        return res.status(422).render('auth/register', {
          title: 'Регистрация',
          description: 'Создайте аккаунт в Книгоманах.',
          errors: { email: result.error },
          formData: { email: req.body.email, name: req.body.name }
        });
      }

      // Письмо с подтверждением: не блокируем ответ, если почта недоступна
      const token = await tokenService.issue(result.user.id, 'verify_email');
      try {
        await sendVerifyEmail(result.user, `${baseUrl()}/podtverdit-pochtu?token=${token}`);
      } catch (mailError) {
        req.log?.error?.('письмо не отправлено', { error: mailError.message });
      }

      req.flash('success', 'Аккаунт создан. Проверьте почту и подтвердите адрес.');
      return res.redirect(303, '/vhod');
    } catch (error) {
      return next(error);
    }
  });

  // --- вход ---
  router.get('/vhod', auth.guestOnly, (req, res) => {
    res.render('auth/login', {
      title: 'Вход',
      description: 'Вход в Книгоманы: полка, прогресс чтения, статистика и клубы на одном экране.',
      formData: {},
      errors: {}
    });
  });

  router.post('/vhod', auth.guestOnly, authLimiter(), async (req, res, next) => {
    try {
      const email = v.email(req.body.email);
      const password = String(req.body.password || '');

      if (email.error || !password) {
        return res.status(422).render('auth/login', {
          title: 'Вход',
          description: 'Вход в Книгоманы: полка, прогресс чтения, статистика и клубы на одном экране.',
          errors: { form: 'Проверьте e-mail и пароль' },
          formData: { email: req.body.email }
        });
      }

      const result = await authService.authenticate({ email: email.value, password });

      if (result.error === 'credentials') {
        return res.status(401).render('auth/login', {
          title: 'Вход',
          description: 'Вход в Книгоманы: полка, прогресс чтения, статистика и клубы на одном экране.',
          errors: { form: 'Неверный e-mail или пароль' },
          formData: { email: req.body.email }
        });
      }

      if (result.error === 'blocked') {
        return res.status(403).render('auth/login', {
          title: 'Вход',
          description: 'Вход в Книгоманы: полка, прогресс чтения, статистика и клубы на одном экране.',
          errors: { form: 'Аккаунт заблокирован. Напишите на support@knigomany.ru' },
          formData: { email: req.body.email }
        });
      }

      await auth.signIn(req, result.user);
      req.flash('success', `С возвращением, ${result.user.name}!`);

      const returnTo = req.session.returnTo;
      delete req.session.returnTo;
      return res.redirect(303, safeReturnTo(returnTo));
    } catch (error) {
      return next(error);
    }
  });

  // --- выход ---
  router.post('/vyhod', auth.requireAuth, async (req, res, next) => {
    try {
      await auth.signOut(req);
      return res.redirect(303, '/');
    } catch (error) {
      return next(error);
    }
  });

  // --- подтверждение почты ---
  router.get('/podtverdit-pochtu', async (req, res, next) => {
    try {
      const result = await tokenService.consume(req.query.token, 'verify_email');

      if (!result.ok) {
        const reasons = {
          expired: 'Срок действия ссылки истёк. Запросите новое письмо.',
          used: 'Эта ссылка уже использована. Войдите в аккаунт.',
          not_found: 'Ссылка не найдена. Возможно, она скопирована не полностью.',
          format: 'Ссылка повреждена. Скопируйте её из письма целиком.'
        };
        return res.status(400).render('auth/message', {
          title: 'Не удалось подтвердить адрес',
          description: 'Подтверждение e-mail',
          heading: 'Ссылка не сработала',
          message: reasons[result.reason] || 'Ссылка недействительна.',
          link: { href: '/vhod', label: 'Перейти ко входу' }
        });
      }

      await authService.markEmailVerified(result.userId);
      req.flash('success', 'Адрес подтверждён. Теперь можно войти.');
      return res.redirect(303, '/vhod');
    } catch (error) {
      return next(error);
    }
  });

  // --- восстановление пароля: запрос ---
  router.get('/vosstanovit-parol', auth.guestOnly, (req, res) => {
    res.render('auth/forgot', {
      title: 'Восстановление пароля',
      description: 'Сброс пароля в Книгоманах: пришлём ссылку на почту, по ней задайте новый пароль.',
      formData: {},
      errors: {}
    });
  });

  router.post('/vosstanovit-parol', auth.guestOnly, authLimiter(), async (req, res, next) => {
    try {
      const email = v.email(req.body.email);

      // Всегда одинаковый ответ: не раскрываем, есть ли такой аккаунт
      const done = () => res.status(200).render('auth/message', {
        title: 'Письмо отправлено',
        description: 'Восстановление пароля',
        heading: 'Проверьте почту',
        message: 'Если такой адрес зарегистрирован, мы отправили письмо со ссылкой. Ссылка действует один час.',
        link: { href: '/vhod', label: 'Вернуться ко входу' }
      });

      if (email.error) return done();

      const user = await models.User.findOne({ where: { email: email.value } });
      if (!user || user.deletedAt) return done();

      const token = await tokenService.issue(user.id, 'reset_password');
      try {
        await sendResetEmail(user, `${baseUrl()}/smenit-parol?token=${token}`);
      } catch (mailError) {
        req.log?.error?.('письмо о сбросе не отправлено', { error: mailError.message });
      }

      return done();
    } catch (error) {
      return next(error);
    }
  });

  // --- восстановление пароля: новая форма ---
  router.get('/smenit-parol', auth.guestOnly, async (req, res, next) => {
    try {
      const token = String(req.query.token || '');
      const found = await tokenService.peek(token, 'reset_password');

      if (!found) {
        return res.status(400).render('auth/message', {
          title: 'Ссылка недействительна',
          description: 'Сброс пароля',
          heading: 'Ссылка недействительна',
          message: 'Возможно, срок её действия истёк или она уже использована. Запросите новое письмо.',
          link: { href: '/vosstanovit-parol', label: 'Запросить письмо заново' }
        });
      }

      return res.render('auth/reset', {
        title: 'Новый пароль',
        description: 'Сброс пароля в Книгоманах: пришлём ссылку на почту, по ней задайте новый пароль.',
        token,
        errors: {},
        formData: {}
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/smenit-parol', auth.guestOnly, async (req, res, next) => {
    try {
      const token = String(req.body.token || '');
      const password = v.passwordPair(req.body.password, req.body.password_confirm);

      if (password.error) {
        return res.status(422).render('auth/reset', {
          title: 'Новый пароль',
          description: 'Сброс пароля в Книгоманах: пришлём ссылку на почту, по ней задайте новый пароль.',
          token,
          errors: { password: password.error },
          formData: {}
        });
      }

      const result = await tokenService.consume(token, 'reset_password');
      if (!result.ok) {
        return res.status(400).render('auth/message', {
          title: 'Ссылка недействительна',
          description: 'Сброс пароля',
          heading: 'Ссылка недействительна',
          message: 'Срок действия истёк или ссылка уже использована. Запросите новое письмо.',
          link: { href: '/vosstanovit-parol', label: 'Запросить письмо заново' }
        });
      }

      const user = await models.User.findByPk(result.userId);
      await authService.changePassword(user, password.value);

      req.flash('success', 'Пароль изменён. Войдите с новым паролем.');
      return res.redirect(303, '/vhod');
    } catch (error) {
      return next(error);
    }
  });

  // --- повторная отправка подтверждения ---
  router.post('/otpravit-podtverzhdenie', auth.requireAuth, async (req, res, next) => {
    try {
      if (req.currentUser.emailVerifiedAt) {
        req.flash('info', 'Адрес уже подтверждён');
        return res.redirect(303, '/nastroyki');
      }

      const token = await tokenService.issue(req.currentUser.id, 'verify_email');
      const user = await models.User.findByPk(req.currentUser.id);
      await sendVerifyEmail(user, `${baseUrl()}/podtverdit-pochtu?token=${token}`);

      req.flash('success', 'Письмо отправлено повторно');
      return res.redirect(303, '/nastroyki');
    } catch (error) {
      return next(error);
    }
  });

  return router;
};

/** Редирект только внутрь сайта: открытый редирект — классическая дыра. */
function safeReturnTo(value) {
  if (!value || typeof value !== 'string') return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

/** Лимит попыток входа: подключается из app.locals. */
function authLimiter() {
  return (req, res, next) => {
    const limiter = req.app.locals.limiters?.auth;
    return limiter ? limiter(req, res, next) : next();
  };
}

function registerLimiter() {
  return (req, res, next) => {
    const limiter = req.app.locals.limiters?.register;
    return limiter ? limiter(req, res, next) : next();
  };
}
