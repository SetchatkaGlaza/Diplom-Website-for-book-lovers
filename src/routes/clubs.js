'use strict';

const express = require('express');
const v = require('../lib/validate');
const { HttpError } = require('../lib/errors');

/**
 * Клубы: список, создание, карточка, заявки, роли, расписание, приглашения.
 *
 * Проверки прав живут в сервисе (`can`), маршруты только переводят ответы
 * в HTTP: 403 при попытке обойти права, 404 для чужих закрытых клубов.
 */
module.exports = function clubRoutes({ models, services, auth }) {
  const router = express.Router();
  const { clubService } = services;

  /** Показать карточку после действия — с сообщением или ошибкой. */
  function back(res, slug, message, type = 'success') {
    if (message) res.req.flash(type, message);
    return res.redirect(303, `/kluby/${slug}`);
  }

  router.get('/kluby', async (req, res, next) => {
    try {
      const search = v.str(req.query.q, 80);
      const clubs = await clubService.list({
        userId: req.currentUser ? req.currentUser.id : null,
        search
      });
      const mine = req.currentUser ? await clubService.myClubs(req.currentUser.id, 6) : [];

      return res.render('clubs/index', {
        title: 'Клубы',
        description: 'Книжные клубы: совместное чтение по главам, обсуждения и расписание.',
        clubs,
        mine,
        search,
        errors: {},
        formData: {}
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/kluby/novyy', auth.requireAuth, (req, res) => res.render('clubs/form', {
    title: 'Новый клуб',
    description: 'Создайте книжный клуб: книга месяца, расписание по главам и обсуждения.',
    errors: {},
    formData: {}
  }));

  router.post('/kluby', auth.requireAuth, async (req, res, next) => {
    try {
      const name = v.text(req.body.name, { min: 3, max: 120, field: 'Название', required: true });
      const description = v.text(req.body.description, { min: 10, max: 2000, field: 'Описание', required: true });

      const errors = {};
      if (name.error) errors.name = name.error;
      if (description.error) errors.description = description.error;

      if (Object.keys(errors).length) {
        return res.status(422).render('clubs/form', {
          title: 'Новый клуб',
          description: 'Создайте книжный клуб: книга месяца, расписание по главам и обсуждения.',
          errors,
          formData: { name: req.body.name, description: req.body.description, isPrivate: req.body.isPrivate }
        });
      }

      const result = await clubService.create({
        ownerId: req.currentUser.id,
        name: name.value,
        description: description.value,
        isPrivate: v.bool(req.body.isPrivate)
      });
      if (result.error) {
        return res.status(422).render('clubs/form', {
          title: 'Новый клуб',
          description: 'Создайте книжный клуб: книга месяца, расписание по главам и обсуждения.',
          errors: { form: result.error },
          formData: { name: req.body.name, description: req.body.description }
        });
      }

      req.flash('success', `Клуб «${result.club.name}» создан. Теперь выберите книгу месяца.`);
      return res.redirect(303, `/kluby/${result.club.slug}`);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/kluby/:slug', async (req, res, next) => {
    try {
      const chapter = req.query.glava ? Number(req.query.glava) : null;
      const data = await clubService.detail({
        slug: req.params.slug,
        viewerId: req.currentUser ? req.currentUser.id : null,
        viewerChapter: chapter
      });
      if (data.error) throw new HttpError(data.status || 404, data.error);

      return res.render('clubs/show', {
        title: data.club.name,
        description: data.club.description.slice(0, 160),
        ...data
      });
    } catch (error) {
      return next(error);
    }
  });

  // Вступление: открытый клуб — сразу, закрытый — заявкой
  router.post('/kluby/:slug/vstupit', auth.requireAuth, async (req, res, next) => {
    try {
      const club = await clubService.find(req.params.slug);
      if (!club) throw new HttpError(404, 'Клуб не найден');

      const result = await clubService.join({
        clubId: club.id,
        userId: req.currentUser.id,
        message: req.body.message
      });
      if (result.error) return back(res, club.slug, result.error, 'error');
      if (result.pending) return back(res, club.slug, 'Заявка отправлена. Владелец клуба увидит её в панели.');

      return back(res, club.slug, `Вы в клубе «${club.name}»`);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/kluby/:slug/vyyti', auth.requireAuth, async (req, res, next) => {
    try {
      const club = await clubService.find(req.params.slug);
      if (!club) throw new HttpError(404, 'Клуб не найден');

      const result = await clubService.leave({ clubId: club.id, userId: req.currentUser.id });
      if (result.error) return back(res, club.slug, result.error, 'error');
      return back(res, club.slug, 'Вы вышли из клуба');
    } catch (error) {
      return next(error);
    }
  });

  router.post('/kluby/:slug/redaktirovat', auth.requireAuth, async (req, res, next) => {
    try {
      const club = await clubService.find(req.params.slug);
      if (!club) throw new HttpError(404, 'Клуб не найден');

      const result = await clubService.update({
        clubId: club.id,
        userId: req.currentUser.id,
        name: req.body.name,
        description: req.body.description,
        isPrivate: req.body.isPrivate === undefined ? undefined : v.bool(req.body.isPrivate),
        currentBookId: req.body.currentBookId === undefined ? undefined : (req.body.currentBookId || null)
      });
      if (result.error) {
        if (result.status === 403) throw new HttpError(403, result.error);
        return back(res, club.slug, result.error, 'error');
      }
      return back(res, club.slug, 'Клуб обновлён');
    } catch (error) {
      return next(error);
    }
  });

  router.post('/kluby/:slug/rol', auth.requireAuth, async (req, res, next) => {
    try {
      const club = await clubService.find(req.params.slug);
      if (!club) throw new HttpError(404, 'Клуб не найден');

      const result = await clubService.setRole({
        clubId: club.id,
        actorId: req.currentUser.id,
        targetUserId: req.body.userId,
        role: req.body.role
      });
      if (result.error) {
        if (result.status === 403) throw new HttpError(403, result.error);
        return back(res, club.slug, result.error, 'error');
      }
      return back(res, club.slug, 'Роль обновлена');
    } catch (error) {
      return next(error);
    }
  });

  router.post('/kluby/:slug/zayavka/:id', auth.requireAuth, async (req, res, next) => {
    try {
      const club = await clubService.find(req.params.slug);
      if (!club) throw new HttpError(404, 'Клуб не найден');

      const decision = req.body.decision === 'accept' ? 'accept' : 'reject';
      const result = await clubService.decideRequest({
        requestId: req.params.id,
        actorId: req.currentUser.id,
        decision
      });
      if (result.error) {
        if (result.status === 403) throw new HttpError(403, result.error);
        return back(res, club.slug, result.error, 'error');
      }
      return back(res, club.slug, decision === 'accept' ? 'Заявка принята' : 'Заявка отклонена');
    } catch (error) {
      return next(error);
    }
  });

  router.post('/kluby/:slug/raspisanie', auth.requireAuth, async (req, res, next) => {
    try {
      const club = await clubService.find(req.params.slug);
      if (!club) throw new HttpError(404, 'Клуб не найден');

      const chapter = v.int(req.body.chapter, { min: 1, max: 2000, field: 'Глава' });
      if (chapter.error) return back(res, club.slug, chapter.error, 'error');

      const result = await clubService.addSchedule({
        clubId: club.id,
        actorId: req.currentUser.id,
        chapter: chapter.value,
        discussionOn: req.body.discussionOn,
        note: req.body.note
      });
      if (result.error) {
        if (result.status === 403) throw new HttpError(403, result.error);
        return back(res, club.slug, result.error, 'error');
      }
      return back(res, club.slug, `Глава ${chapter.value} добавлена в расписание`);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/kluby/:slug/obsuzhdenie', auth.requireAuth, async (req, res, next) => {
    try {
      return await createPost(req, res, next);
    } catch (error) {
      return next(error);
    }
  });

  async function createPost(req, res, next) {
    const club = await clubService.find(req.params.slug);
    if (!club) throw new HttpError(404, 'Клуб не найден');

    const result = await clubService.addPost({
      clubId: club.id,
      userId: req.currentUser.id,
      body: req.body.body,
      chapter: req.body.chapter,
      hasSpoilers: v.bool(req.body.hasSpoilers)
    });
    if (result.error) {
      if (result.status === 403) throw new HttpError(403, result.error);
      return back(res, club.slug, result.error, 'error');
    }
    return back(res, club.slug, 'Сообщение добавлено');
  }

  router.post('/kluby/:slug/post/:id/skryt', auth.requireAuth, async (req, res, next) => {
    try {
      const club = await clubService.find(req.params.slug);
      if (!club) throw new HttpError(404, 'Клуб не найден');

      const result = await clubService.hidePost({ postId: req.params.id, actorId: req.currentUser.id });
      if (result.error) {
        if (result.status === 403) throw new HttpError(403, result.error);
        return back(res, club.slug, result.error, 'error');
      }
      return back(res, club.slug, 'Сообщение скрыто');
    } catch (error) {
      return next(error);
    }
  });

  router.post('/kluby/:slug/priglashenie', auth.requireAuth, async (req, res, next) => {
    try {
      const club = await clubService.find(req.params.slug);
      if (!club) throw new HttpError(404, 'Клуб не найден');

      const result = await clubService.createInvite({
        clubId: club.id,
        actorId: req.currentUser.id,
        maxUses: req.body.maxUses,
        days: req.body.days
      });
      if (result.error) {
        if (result.status === 403) throw new HttpError(403, result.error);
        return back(res, club.slug, result.error, 'error');
      }
      return back(res, club.slug, `Ссылка-приглашение готова: /priglashenie/${result.invite.code}`);
    } catch (error) {
      return next(error);
    }
  });

  // Приглашение показывается до входа: человек видит, куда его зовут
  router.get('/priglashenie/:code', async (req, res, next) => {
    try {
      const invite = await models.ClubInvite.findOne({ where: { code: req.params.code } });
      if (!invite) throw new HttpError(404, 'Приглашение не найдено');

      const club = await models.Club.findByPk(invite.clubId);
      if (!club) throw new HttpError(404, 'Клуб не найден');

      const exhausted = invite.usesCount >= invite.maxUses;
      const expired = invite.expiresAt && new Date(invite.expiresAt) < new Date();

      return res.render('clubs/invite', {
        title: `Приглашение в «${club.name}»`,
        description: `Вас приглашают в книжный клуб «${club.name}».`,
        club,
        invite,
        exhausted,
        expired
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/priglashenie/:code', auth.requireAuth, async (req, res, next) => {
    try {
      const result = await clubService.useInvite({ code: req.params.code, userId: req.currentUser.id });
      if (result.error) {
        req.flash('error', result.error);
        return res.redirect(303, `/priglashenie/${req.params.code}`);
      }
      req.flash('success', `Добро пожаловать в «${result.club.name}»`);
      return res.redirect(303, `/kluby/${result.club.slug}`);
    } catch (error) {
      return next(error);
    }
  });

  return router;
};
