'use strict';

/**
 * Загрузка пользователя и проверки доступа.
 *
 * Пользователь читается из БД на каждый запрос (кэш 60 секунд), поэтому
 * смена роли, блокировка и смена пароля применяются сразу, а не «когда-нибудь».
 */

const CACHE_TTL_MS = 60 * 1000;
const CACHE_MAX = 5000;
const cache = new Map();

function cacheGet(userId) {
  const hit = cache.get(userId);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(userId);
    return null;
  }
  return hit.user;
}

function cacheSet(userId, user) {
  if (cache.size > CACHE_MAX) cache.clear();
  cache.set(userId, { at: Date.now(), user });
}

function cacheDrop(userId) {
  cache.delete(userId);
}

function publicUser(row) {
  const user = typeof row.toJSON === 'function' ? row.toJSON() : row;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    trustLevel: user.trustLevel,
    sessionEpoch: user.sessionEpoch,
    isBlocked: user.isBlocked,
    blockedUntil: user.blockedUntil,
    avatar: user.avatar,
    bio: user.bio,
    createdAt: user.createdAt
  };
}

function createAuthMiddleware({ User }) {
  const auth = {};

  /** Кто пришёл: гость или пользователь. Никогда не бросает 401 сам. */
  auth.loadUser = async function loadUser(req, res, next) {
    try {
      res.locals.currentUser = null;
      const sessionUser = req.session?.user;
      if (!sessionUser) return next();

      let user = cacheGet(sessionUser.id);
      if (!user) {
        const row = await User.findByPk(sessionUser.id);
        if (!row) {
          req.session.user = null;
          return next();
        }
        user = publicUser(row);
        cacheSet(user.id, user);
      }

      // Смена пароля или принудительный выход меняют epoch — сессия становится недействительной
      if (user.sessionEpoch !== sessionUser.epoch) {
        req.session.user = null;
        return next();
      }

      const blocked = user.isBlocked
        && (!user.blockedUntil || new Date(user.blockedUntil) > new Date());
      if (blocked) {
        req.session.user = null;
        return next();
      }

      req.currentUser = user;
      res.locals.currentUser = user;
      return next();
    } catch (error) {
      return next(error);
    }
  };

  auth.requireAuth = function requireAuth(req, res, next) {
    if (req.currentUser) return next();

    // Гостя уводим на вход: для обычной отправки формы (не fetch/JSON)
    if (req.method === 'GET' || req.is('application/x-www-form-urlencoded') || req.is('multipart/form-data')) {
      if (req.session) req.session.returnTo = req.originalUrl;
      if (typeof req.flash === 'function') req.flash('info', 'Войдите, чтобы продолжить');
      return res.redirect(303, '/vhod');
    }

    const error = new Error('Это действие доступно после входа в аккаунт.');
    error.status = 401;
    return next(error);
  };

  auth.requireRole = function requireRole(...roles) {
    return function roleGuard(req, res, next) {
      if (!req.currentUser) return auth.requireAuth(req, res, next);
      if (roles.includes(req.currentUser.role)) return next();
      const error = new Error('Недостаточно прав для этого действия.');
      error.status = 403;
      return next(error);
    };
  };

  /** Гость не должен видеть формы входа, если он уже вошёл. */
  auth.guestOnly = function guestOnly(req, res, next) {
    if (req.currentUser) return res.redirect(303, '/');
    return next();
  };

  auth.signIn = function signIn(req, user) {
    return new Promise((resolve, reject) => {
      req.session.regenerate((error) => {
        if (error) return reject(error);
        req.session.user = { id: user.id, epoch: user.sessionEpoch || 0 };
        cacheDrop(user.id);
        return resolve();
      });
    });
  };

  auth.signOut = function signOut(req) {
    return new Promise((resolve, reject) => {
      const userId = req.currentUser?.id;
      req.session.destroy((error) => {
        if (userId) cacheDrop(userId);
        if (error) return reject(error);
        return resolve();
      });
    });
  };

  /** Обновление пользователя в БД и сброс кэша (роль, блокировка, пароль). */
  auth.invalidate = function invalidate(userId) {
    cacheDrop(userId);
  };

  auth.clearCache = () => cache.clear();

  return auth;
}

module.exports = { createAuthMiddleware, publicUser };
