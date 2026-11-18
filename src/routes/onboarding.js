'use strict';

const express = require('express');
const v = require('../lib/validate');

/**
 * Онбординг после регистрации и импорт/экспорт полки.
 *
 * Файл CSV приходит как обычное текстовое поле (без multer): форма отправляет
 * содержимое файла, браузер шлёт его в поле `file`. Лимит тела запроса — 200 КБ,
 * а для импорта поднимаем до 6 МБ только на этом маршруте.
 */
module.exports = function onboardingRoutes({ models, services, auth }) {
  const router = express.Router();
  const { onboardingService, importService } = services;

  // ---------- Онбординг ----------

  router.get('/start', auth.requireAuth, async (req, res, next) => {
    try {
      const step = ['zhanry', 'knigi', 'tsel'].includes(req.query.shag) ? req.query.shag : 'zhanry';
      const genres = await models.Genre.findAll({ order: [['name', 'ASC']], attributes: ['id', 'name', 'slug'] });

      const selected = String(req.query.zhanry || '')
        .split(',')
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0);

      const books = step === 'knigi'
        ? await onboardingService.suggestions({ genreIds: selected, limit: 12, excludeUserId: req.currentUser.id })
        : [];

      return res.render('onboarding/start', {
        title: 'Настройка дневника',
        description: 'Три шага: жанры, первые книги и цель на год.',
        step,
        steps: onboardingService.STEPS,
        genres,
        selected,
        books,
        errors: {},
        formData: {}
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/start/zhanry', auth.requireAuth, async (req, res, next) => {
    try {
      const chosen = [].concat(req.body.zhanry || []).filter(Boolean);
      if (!chosen.length) {
        const genres = await models.Genre.findAll({ order: [['name', 'ASC']], attributes: ['id', 'name', 'slug'] });
        return res.status(422).render('onboarding/start', {
          title: 'Настройка дневника',
          description: 'Три шага: жанры, первые книги и цель на год.',
          step: 'zhanry',
          steps: onboardingService.STEPS,
          genres,
          selected: [],
          books: [],
          errors: { genres: 'Выберите хотя бы один жанр — иначе не поймём, что советовать' },
          formData: {}
        });
      }

      const result = await onboardingService.saveGenres({ userId: req.currentUser.id, genreIds: chosen });
      if (result.error) {
        return res.status(422).render('onboarding/start', {
          title: 'Настройка дневника',
          description: 'Три шага: жанры, первые книги и цель на год.',
          step: 'zhanry',
          steps: onboardingService.STEPS,
          genres: [],
          selected: [],
          books: [],
          errors: { genres: result.error },
          formData: {}
        });
      }

      return res.redirect(303, `/start?shag=knigi&zhanry=${result.genreIds.join(',')}`);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/start/knigi', auth.requireAuth, async (req, res, next) => {
    try {
      const chosen = [].concat(req.body.bookIds || []).filter(Boolean);
      const result = await onboardingService.saveBooks({ userId: req.currentUser.id, bookIds: chosen });

      if (result.error) {
        const selected = String(req.body.zhanry || '').split(',').map(Number).filter(Boolean);
        const books = await onboardingService.suggestions({
          genreIds: selected, limit: 12, excludeUserId: req.currentUser.id
        });
        return res.status(422).render('onboarding/start', {
          title: 'Настройка дневника',
          description: 'Три шага: жанры, первые книги и цель на год.',
          step: 'knigi',
          steps: onboardingService.STEPS,
          genres: [],
          selected,
          books,
          errors: { books: result.error },
          formData: {}
        });
      }

      return res.redirect(303, '/start?shag=tsel');
    } catch (error) {
      return next(error);
    }
  });

  router.post('/start/tsel', auth.requireAuth, async (req, res, next) => {
    try {
      const target = v.int(req.body.target, { min: 1, max: 1000, field: 'Цель' });
      if (target.error) {
        return res.status(422).render('onboarding/start', {
          title: 'Настройка дневника',
          description: 'Три шага: жанры, первые книги и цель на год.',
          step: 'tsel',
          steps: onboardingService.STEPS,
          genres: [],
          selected: [],
          books: [],
          errors: { target: target.error },
          formData: { target: req.body.target }
        });
      }

      await onboardingService.saveGoal({ userId: req.currentUser.id, target: target.value });
      req.flash('success', 'Дневник настроен. Полка уже не пустая — приятного чтения!');
      return res.redirect(303, '/polka');
    } catch (error) {
      return next(error);
    }
  });

  // ---------- Импорт и экспорт ----------

  // Тело с файлом бывает большим: 6 МБ только здесь
  router.use('/import', express.urlencoded({ extended: false, limit: '6mb' }));

  router.get('/import', auth.requireAuth, (req, res) => res.render('import/index', {
    title: 'Импорт полки',
    description: 'Перенесите полку из Goodreads или LiveLib одним CSV-файлом.',
    report: null,
    errors: {},
    preview: null
  }));

  router.post('/import', auth.requireAuth, async (req, res, next) => {
    try {
      const text = req.body.file || req.body.csv || '';
      if (!String(text).trim()) {
        return res.status(422).render('import/index', {
          title: 'Импорт полки',
          description: 'Перенесите полку из Goodreads или LiveLib одним CSV-файлом.',
          report: null,
          preview: null,
          errors: { file: 'Прикрепите CSV-файл или вставьте его содержимое в поле ниже' }
        });
      }

      const dryRun = req.body.dryRun === '1';
      const result = await importService.run({ userId: req.currentUser.id, text, dryRun });

      if (result.error) {
        return res.status(422).render('import/index', {
          title: 'Импорт полки',
          description: 'Перенесите полку из Goodreads или LiveLib одним CSV-файлом.',
          report: null,
          preview: null,
          errors: { file: result.error }
        });
      }

      if (dryRun) {
        return res.render('import/index', {
          title: 'Импорт полки',
          description: 'Перенесите полку из Goodreads или LiveLib одним CSV-файлом.',
          report: null,
          preview: result,
          errors: {}
        });
      }

      req.flash('success', `Импорт готов: добавлено ${result.added}, обновлено ${result.updated} из ${result.total}`);
      return res.render('import/index', {
        title: 'Импорт полки',
        description: 'Перенесите полку из Goodreads или LiveLib одним CSV-файлом.',
        report: result,
        preview: null,
        errors: {}
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/eksport', auth.requireAuth, async (req, res, next) => {
    try {
      const result = await importService.exportCsv(req.currentUser.id);
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', 'attachment; filename="knigomany-polka.csv"');
      return res.send(result.csv);
    } catch (error) {
      return next(error);
    }
  });

  return router;
};
