'use strict';

const express = require('express');
const v = require('../lib/validate');
const { HttpError } = require('../lib/errors');
const { STATUSES, STATUS_KEYS } = require('../services/shelf');

/**
 * Полка читателя.
 *
 *   /polka                  — все книги, фильтр по статусу
 *   /polka/:slug/progress   — отметить страницы (обычная форма и JSON для быстрой отметки)
 *   /polka/:slug/status     — сменить статус
 *   /polka/:slug/reread     — начать перечитывать
 *   /polka/:slug/favorite   — сердечко
 *   /polka/:slug/remove     — снять с полки
 *   /polka/tsel             — цель на год
 *
 * Все действия требуют входа: чужую полку менять нельзя, а своей у гостя нет.
 */
module.exports = function shelfRoutes({ models, services, auth }) {
  const router = express.Router();
  const shelf = services.shelfService;

  router.get('/polka', auth.requireAuth, async (req, res, next) => {
    try {
      const status = STATUS_KEYS.includes(req.query.status) ? req.query.status : null;
      const [items, counts, goal] = await Promise.all([
        shelf.list(req.currentUser.id, { status }),
        shelf.counts(req.currentUser.id),
        shelf.goalProgress(req.currentUser.id)
      ]);

      const countsByStatus = STATUSES.map((item) => ({
        ...item,
        count: counts[item.key] || 0
      }));
      const activeLabel = status
        ? (countsByStatus.find((item) => item.key === status) || {}).label
        : null;

      // Пустая полка — худший первый экран: сразу показываем, с чего начать
      const suggestions = !items.length && !status && services.onboardingService
        ? await services.onboardingService.forEmptyShelf(req.currentUser.id, 6)
        : [];

      res.render('shelf/index', {
        title: status ? `${shelfLabel(status)} — моя полка` : 'Моя полка',
        description: 'Личная полка чтения: что читаю, что прочитал, что хочу прочитать и что бросил.',
        items,
        suggestions,
        counts,
        countsByStatus,
        activeStatus: status,
        activeLabel,
        goal,
        year: new Date().getFullYear()
      });
    } catch (error) {
      return next(error);
    }
  });

  // --- цель на год ---
  router.post('/polka/tsel', auth.requireAuth, async (req, res, next) => {
    try {
      const year = new Date().getFullYear();
      const target = Number(req.body.target);
      const result = await shelf.setGoal(req.currentUser.id, year, target);

      if (result.error) {
        req.flash('error', result.error);
        return res.redirect(303, '/polka');
      }

      req.flash('success', result.hasGoal
        ? `Цель на ${year} год: ${result.target} книг`
        : 'Цель обновлена');
      return res.redirect(303, '/polka');
    } catch (error) {
      return next(error);
    }
  });

  /** Общая часть всех действий с книгой: найти книгу и запись. */
  async function loadBook(req) {
    const check = v.slug(req.params.slug);
    if (check.error) throw new HttpError(404, 'Книга не найдена');
    const book = await models.Book.findOne({ where: { slug: check.value } });
    if (!book) throw new HttpError(404, 'Книга не найдена');
    return book;
  }

  /**
   * Быстрая отметка прогресса. Если запрос пришёл из скрипта (fetch) —
   * отвечаем JSON, чтобы страница обновилась без перезагрузки.
   * Работает и без скрипта: обычная форма делает редирект.
   */
  router.post('/polka/:slug/progress', auth.requireAuth, async (req, res, next) => {
    try {
      const book = await loadBook(req);
      const pages = Number.parseInt(req.body.pages, 10);
      if (!Number.isFinite(pages)) {
        return respond(req, res, 422, { error: 'Введите номер страницы числом' }, '/polka');
      }

      const result = await shelf.setProgress({
        userId: req.currentUser.id,
        bookId: book.id,
        pages,
        book
      });

      if (result.error) return respond(req, res, 422, { error: result.error }, `/knigi/${book.slug}`);

      await shelf.recountShelves(book.id);

      // Дочитал до конца — отдельное событие в ленте
      if (result.finished && services.socialService) {
        await services.socialService.record({ userId: req.currentUser.id, type: 'finished', bookId: book.id });
      }

      const payload = {
        ok: true,
        status: result.entry.status,
        statusLabel: result.entry.statusLabel,
        progressPages: result.entry.progressPages,
        totalPages: result.entry.totalPages,
        percent: result.entry.percent,
        finished: Boolean(result.finished)
      };

      const message = result.finished
        ? `«${book.title}» прочитана — поздравляем!`
        : `Отмечено: ${payload.progressPages} из ${payload.totalPages || '?'} страниц`;
      req.flash(result.finished ? 'success' : 'info', message);

      return respond(req, res, 200, payload, req.body.return_to || '/polka');
    } catch (error) {
      return next(error);
    }
  });

  router.post('/polka/:slug/status', auth.requireAuth, async (req, res, next) => {
    try {
      const book = await loadBook(req);
      const result = await shelf.setStatus({
        userId: req.currentUser.id,
        bookId: book.id,
        status: req.body.status,
        book
      });

      if (result.error) return next(new HttpError(422, result.error));

      await shelf.recountShelves(book.id);

      // Лента: «добавил на полку» и «дочитал» — разные события
      if (services.socialService) {
        if (result.entry.status === 'read') {
          await services.socialService.record({ userId: req.currentUser.id, type: 'finished', bookId: book.id });
        } else if (result.entry.status !== 'dnf') {
          await services.socialService.record({
            userId: req.currentUser.id, type: 'shelf', bookId: book.id, meta: { status: result.entry.status }
          });
        }
      }

      req.flash('success', `«${book.title}»: ${result.entry.statusLabel.toLowerCase()}`);
      return res.redirect(303, safePath(req.body.return_to, `/knigi/${book.slug}`));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/polka/:slug/reread', auth.requireAuth, async (req, res, next) => {
    try {
      const book = await loadBook(req);
      const result = await shelf.reread({ userId: req.currentUser.id, bookId: book.id });
      if (result.error) return next(new HttpError(422, result.error));

      req.flash('success', `Перечитываете «${book.title}», раз №${result.entry.rereadCount + 1}`);
      return res.redirect(303, safePath(req.body.return_to, '/polka'));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/polka/:slug/favorite', auth.requireAuth, async (req, res, next) => {
    try {
      const book = await loadBook(req);
      const result = await shelf.toggleFavorite({ userId: req.currentUser.id, bookId: book.id });
      if (result.error) return next(new HttpError(422, result.error));

      req.flash('info', result.entry.isFavorite ? 'Добавлено в любимые' : 'Убрано из любимых');
      return res.redirect(303, safePath(req.body.return_to, '/polka'));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/polka/:slug/remove', auth.requireAuth, async (req, res, next) => {
    try {
      const book = await loadBook(req);
      const result = await shelf.remove({ userId: req.currentUser.id, bookId: book.id });
      await shelf.recountShelves(book.id);

      req.flash('info', result.removed ? `«${book.title}» убрана с полки` : 'Этой книги на полке не было');
      return res.redirect(303, safePath(req.body.return_to, '/polka'));
    } catch (error) {
      return next(error);
    }
  });

  return router;
};

function shelfLabel(key) {
  const found = STATUSES.find((status) => status.key === key);
  return found ? found.label : key;
}

/** Редирект только внутрь сайта: чужой адрес в поле формы — это открытый редирект. */
function safePath(value, fallback) {
  const path = String(value || '');
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return fallback;
  return path.slice(0, 300);
}

/**
 * Ответ на действие с прогрессом: JSON для скрипта, редирект для обычной формы.
 */
function respond(req, res, status, payload, redirectTo) {
  const wantsJson = req.xhr || req.is('application/json') || String(req.get('accept') || '').includes('application/json');
  if (wantsJson) return res.status(status).json(payload);
  if (status >= 400) {
    req.flash('error', payload.error);
    return res.redirect(303, redirectTo);
  }
  return res.redirect(303, safePath(req.body.return_to, redirectTo));
}

module.exports.safePath = safePath;
