'use strict';

const express = require('express');
const { HttpError } = require('../lib/errors');
const { emailHash } = require('../services/digest');

/**
 * Дайджест: отписка по ссылке из письма и ручной запуск из админки.
 *
 * Отписка открыта гостю: человек приходит по ссылке из письма и, скорее
 * всего, не помнит пароль. Ссылка содержит хеш адреса, а не id: по ней
 * нельзя перебрать чужие адреса, а отписаться можно в один клик.
 *
 * Рассылку нельзя вешать на таймер внутри приложения: при нескольких
 * инстансах письма уйдут дважды. Запуск — отдельной командой (cron) или
 * кнопкой в админке; повторный запуск безопасен, дубли отсекает журнал.
 */
module.exports = function digestRoutes({ models, services, auth }) {
  const router = express.Router();
  const digest = services.digestService;

  function requireStaff(req, res, next) {
    if (!req.currentUser) return auth.requireAuth(req, res, next);
    if (!['moderator', 'admin'].includes(req.currentUser.role)) {
      return next(new HttpError(403, 'Раздел доступен только модераторам'));
    }
    return next();
  }

  // --- отписка из письма ---
  router.get('/otpiska', async (req, res, next) => {
    try {
      const hash = String(req.query.e || '').trim().toLowerCase();
      const valid = /^[a-f0-9]{64}$/.test(hash);

      res.render('digest/unsubscribe', {
        title: 'Отписка от писем',
        description: 'Отписаться от писем Книгоманов можно в один клик, без входа в аккаунт.',
        // Форма отправляет хеш обратно: сам адрес по ссылке не ходит
        hash: valid ? hash : null,
        done: req.query.gotovo === '1',
        error: valid ? null : 'Ссылка выглядит неполной. Откройте её из письма целиком или отключите письма в настройках.'
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/otpiska', async (req, res, next) => {
    try {
      const hash = String(req.body.e || '').trim().toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(hash)) {
        return next(new HttpError(400, 'Ссылка отписки неполная'));
      }

      // Ищем человека по хешу: адрес в базе есть, но по ссылке его не видно
      const users = await models.User.findAll({ attributes: ['id', 'email'], limit: 10000 });
      const found = users.find((user) => emailHash(user.email) === hash);

      if (found) {
        await digest.unsubscribe(found.email, { kind: 'all', reason: 'по ссылке из письма' });
      } else {
        // Письмо могло уйти на адрес, который потом сменили: отписываем по хешу
        await models.EmailUnsubscribe.findOrCreate({
          where: { emailHash: hash },
          defaults: { emailHash: hash, kind: 'all', reason: 'адрес не найден в аккаунтах' }
        });
      }

      return res.redirect(303, '/otpiska?gotovo=1');
    } catch (error) {
      return next(error);
    }
  });

  // --- ручной запуск из админки ---
  router.get('/admin/rassylka', requireStaff, async (req, res, next) => {
    try {
      const [stats, recent, ready] = await Promise.all([
        digest.stats({ days: 30 }),
        models.Digest.findAll({
          attributes: ['id', 'kind', 'status', 'sentAt', 'error'],
          include: [{ model: models.User, as: 'user', attributes: ['name', 'email'] }],
          order: [['id', 'DESC']],
          limit: 30
        }),
        digest.recipients({ kind: 'weekly', limit: 500 })
      ]);

      return res.render('admin/digest', {
        title: 'Рассылка',
        description: 'Дайджест: кому можно писать, что ушло и что сломалось.',
        stats,
        recent,
        readyCount: ready.length,
        result: req.query.itog || null,
        rules: digest.RULES
      });
    } catch (error) {
      return next(error);
    }
  });

  /**
   * Прогон рассылки.
   * dryRun=1 — показать письма, ничего не отправляя: именно так проверяют
   * текст, прежде чем разослать его живым людям.
   */
  router.post('/admin/rassylka', requireStaff, async (req, res, next) => {
    try {
      const kind = req.body.kind === 'comeback' ? 'comeback' : 'weekly';
      const dryRun = req.body.dryRun === '1' || req.body.dryRun === 'on';
      const limit = Math.min(500, Math.max(1, Number(req.body.limit) || 50));

      const result = await digest.run({ kind, dryRun, limit });

      req.flash('success', dryRun
        ? `Пробный прогон: ${result.letters.length} писем собрано, ни одно не отправлено`
        : `Отправлено ${result.sent}, пропущено ${result.skipped}, ошибок ${result.failed}`);
      return res.redirect(303, `/admin/rassylka?itog=${dryRun ? 'dry' : 'sent'}`);
    } catch (error) {
      return next(error);
    }
  });

  return router;
};
