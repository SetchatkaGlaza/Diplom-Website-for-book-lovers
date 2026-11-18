'use strict';

const express = require('express');
const { HttpError } = require('../lib/errors');

/**
 * Жалобы и админка модерации.
 *
 * Права проверяются дважды: middleware `requireStaff` не пускает в админку,
 * а сервис отдельно проверяет каждое действие. Так нельзя открыть действие
 * по прямой ссылке, если роль сняли в соседней вкладке.
 */
module.exports = function moderationRoutes({ models, services, auth }) {
  const router = express.Router();
  const { moderationService } = services;

  function requireStaff(req, res, next) {
    if (!req.currentUser) return auth.requireAuth(req, res, next);
    if (!['moderator', 'admin'].includes(req.currentUser.role)) {
      return next(new HttpError(403, 'Раздел доступен только модераторам'));
    }
    return next();
  }

  // ---------- Жалоба с любой страницы ----------

  router.post('/zhaloba', auth.requireAuth, async (req, res, next) => {
    try {
      const result = await moderationService.report({
        reporterId: req.currentUser.id,
        subjectType: req.body.subjectType,
        subjectId: req.body.subjectId,
        reason: req.body.reason
      });

      const back = req.body.back && String(req.body.back).startsWith('/') ? String(req.body.back) : '/';

      if (result.error) {
        req.flash('error', result.error);
        return res.redirect(303, back);
      }

      await moderationService.log({
        actorId: req.currentUser.id,
        action: 'report.create',
        subjectType: req.body.subjectType,
        subjectId: Number(req.body.subjectId),
        note: String(req.body.reason).slice(0, 300)
      });

      req.flash('success', 'Жалоба отправлена. Модератор посмотрит её в порядке очереди.');
      return res.redirect(303, back);
    } catch (error) {
      return next(error);
    }
  });

  // ---------- Админка ----------

  /**
   * Сводка владельца: цифры, топ книг, чек-лист.
   * Отдельно от жалоб: смотреть «как дела» и «что нарушено» — разные задачи.
   */
  router.get('/admin/svodka', requireStaff, async (req, res, next) => {
    try {
      const { transportKind } = require('../lib/mailer');
      const { publicUrl } = require('../config/env');

      const [data, checklist, funnel, dropoff] = await Promise.all([
        services.adminService.overview({ days: 14 }),
        services.adminService.checklist({ mailTransportKind: transportKind, publicUrl: publicUrl() }),
        services.adminService.funnel({ days: 30 }),
        services.adminService.dropoff({ days: 30, silentForDays: 7 })
      ]);

      return res.render('admin/overview', {
        title: 'Сводка',
        description: 'Цифры сайта: читатели, возвраты, воронка активации и что поправить.',
        data,
        checklist,
        funnel,
        dropoff
      });
    } catch (error) {
      return next(error);
    }
  });

  // ---------- Обратная связь в админке ----------

  router.get('/admin/obratnaya-svyaz', requireStaff, async (req, res, next) => {
    try {
      const items = await services.moderationService.feedbackList({ limit: 200 });
      return res.render('admin/feedback', {
        title: 'Обратная связь',
        description: 'Что пишут читатели: неудобства, ошибки и идеи.',
        items
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/admin/zhaloby', requireStaff, async (req, res, next) => {
    try {
      const state = ['open', 'resolved', 'rejected'].includes(req.query.sostoyanie) ? req.query.sostoyanie : 'open';
      const [items, statistics, journal] = await Promise.all([
        moderationService.queue({ state }),
        Promise.all([
          models.Report.count({ where: { state: 'open' } }),
          models.Report.count({ where: { state: 'resolved' } }),
          models.User.count({ where: { isBlocked: true } })
        ]),
        moderationService.history({ limit: 20 })
      ]);

      return res.render('admin/reports', {
        title: 'Жалобы',
        description: 'Очередь жалоб и журнал действий модерации.',
        items,
        state,
        statistics: { open: statistics[0], resolved: statistics[1], blocked: statistics[2] },
        journal,
        reasons: moderationService.REASONS
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/admin/zhaloby/:id', requireStaff, async (req, res, next) => {
    try {
      const action = ['hide', 'block', 'reject'].includes(req.body.action) ? req.body.action : 'reject';
      const result = await moderationService.resolve({
        reportId: req.params.id,
        moderatorId: req.currentUser.id,
        action,
        note: req.body.note
      });

      if (result.error) {
        req.flash('error', result.error);
        return res.redirect(303, '/admin/zhaloby');
      }

      const messages = {
        hide: 'Контент скрыт, автору ушло уведомление',
        block: 'Автор заблокирован на 7 дней',
        reject: 'Жалоба отклонена'
      };
      req.flash('success', messages[action]);
      return res.redirect(303, '/admin/zhaloby');
    } catch (error) {
      return next(error);
    }
  });

  router.get('/admin/polzovateli', requireStaff, async (req, res, next) => {
    try {
      const search = String(req.query.q || '').trim().slice(0, 60);
      const { Op } = require('sequelize');
      const where = search ? { name: { [Op.iLike]: `%${search}%` } } : {};

      const users = await models.User.findAll({
        where,
        attributes: ['id', 'name', 'email', 'role', 'trustLevel', 'isBlocked', 'blockedUntil', 'createdAt'],
        order: [['createdAt', 'DESC']],
        limit: 50
      });

      return res.render('admin/users', {
        title: 'Пользователи',
        description: 'Блокировки и уровни доверия.',
        users,
        search,
        levels: moderationService.TRUST_LEVELS
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/admin/polzovateli/:id/blokirovka', requireStaff, async (req, res, next) => {
    try {
      const days = Number(req.body.days);
      const safeDays = Number.isFinite(days) ? Math.min(3650, Math.max(0, days)) : 7;

      const result = req.body.unblock === '1'
        ? await moderationService.unblockUser({ userId: req.params.id, moderatorId: req.currentUser.id })
        : await moderationService.blockUser({
          userId: req.params.id,
          moderatorId: req.currentUser.id,
          days: safeDays,
          reason: req.body.reason
        });

      if (result.error) {
        req.flash('error', result.error);
        return res.redirect(303, '/admin/polzovateli');
      }

      req.flash('success', req.body.unblock === '1' ? 'Блокировка снята' : 'Пользователь заблокирован');
      return res.redirect(303, '/admin/polzovateli');
    } catch (error) {
      return next(error);
    }
  });

  // ---------- Обратная связь (бета) ----------

  const FEEDBACK_KINDS = ['неудобно', 'ошибка', 'идея', 'другое'];

  router.get('/obratnaya-svyaz', (req, res) => res.render('legal/feedback', {
    title: 'Обратная связь',
    description: 'Напишите, что на Книгоманах неудобно или не работает: читает автор проекта, отвечает в течение пары дней.',
    errors: {},
    formData: { page: String(req.query.stranitsa || '') },
    kinds: FEEDBACK_KINDS,
    sent: false
  }));

  // Лимит на отправку: 5 сообщений в час с одного IP. Форма открыта гостям,
  // поэтому без лимита она превращается в бесплатный спам-канал.
  function contactLimiter() {
    return (req, res, next) => {
      const limiter = req.app.locals.limiters?.contact;
      return limiter ? limiter(req, res, next) : next();
    };
  }

  router.post('/obratnaya-svyaz', contactLimiter(), async (req, res, next) => {
    try {
      const result = await moderationService.feedback({
        name: req.body.name,
        email: req.body.email,
        kind: req.body.kind,
        text: req.body.text,
        page: req.body.page
      });

      if (result.errors) {
        return res.status(422).render('legal/feedback', {
          title: 'Обратная связь',
          description: 'Напишите, что на Книгоманах неудобно или не работает.',
          errors: result.errors,
          formData: req.body,
          kinds: FEEDBACK_KINDS,
          sent: false
        });
      }

      return res.render('legal/feedback', {
        title: 'Обратная связь',
        description: 'Напишите, что на Книгоманах неудобно или не работает.',
        errors: {},
        formData: {},
        kinds: FEEDBACK_KINDS,
        sent: true
      });
    } catch (error) {
      return next(error);
    }
  });

  // ---------- Правообладателям ----------

  router.get('/pravoobladatelyam', (req, res) => res.render('legal/copyright', {
    title: 'Правообладателям',
    description: 'Как сообщить о нарушении авторских прав и что мы делаем в ответ. Срок ответа — 48 часов.',
    errors: {},
    formData: {},
    sent: false
  }));

  router.post('/pravoobladatelyam', async (req, res, next) => {
    try {
      const result = await moderationService.copyrightClaim({
        name: req.body.name,
        email: req.body.email,
        subject: req.body.subject,
        text: req.body.text
      });

      if (result.errors) {
        return res.status(422).render('legal/copyright', {
          title: 'Правообладателям',
          description: 'Как сообщить о нарушении авторских прав и что мы делаем в ответ. Срок ответа — 48 часов.',
          errors: result.errors,
          formData: req.body,
          sent: false
        });
      }

      return res.render('legal/copyright', {
        title: 'Правообладателям',
        description: 'Как сообщить о нарушении авторских прав и что мы делаем в ответ. Срок ответа — 48 часов.',
        errors: {},
        formData: {},
        sent: true
      });
    } catch (error) {
      return next(error);
    }
  });

  // ---------- Юридические страницы ----------

  const LEGAL = {
    soglashenie: {
      view: 'legal/terms',
      title: 'Пользовательское соглашение',
      description: 'Условия использования «Книгоманов»: что можно, что нельзя и кто за что отвечает.'
    },
    konfidentsialnost: {
      view: 'legal/privacy',
      title: 'Политика конфиденциальности',
      description: 'Какие данные мы храним, зачем и как их удалить.'
    },
    pravila: {
      view: 'legal/rules',
      title: 'Правила сообщества',
      description: 'Правила общения: спойлеры, грубость, реклама и авторские права.'
    }
  };

  router.get('/o-proekte', (req, res) => res.render('legal/about', {
    title: 'О проекте',
    description: '«Книгоманы» — читательский дневник без рекламы: полка, прогресс, статистика, рецензии и клубы.'
  }));

  Object.entries(LEGAL).forEach(([slug, page]) => {
    router.get(`/${slug}`, (req, res) => res.render(page.view, {
      title: page.title,
      description: page.description
    }));
  });

  return router;
};
