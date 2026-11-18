'use strict';

const EMPTY = { success: [], error: [], info: [] };

function emptyBag() {
  return { success: [], error: [], info: [] };
}

/**
 * Flash-сообщения без connect-flash: живут в сессии один переход.
 *
 * Важно: после req.session.regenerate() (вход, выход) объект сессии новый,
 * поэтому req.flash не должен держать ссылку на старый bag — он всегда
 * читает req.session.flash в момент вызова.
 */
function flashMiddleware() {
  return function flash(req, res, next) {
    if (!req.session) {
      req.flash = () => '';
      res.locals.flash = emptyBag();
      return next();
    }

    const bag = req.session.flash || emptyBag();
    req.session.flash = emptyBag();
    res.locals.flash = bag;

    req.flash = (type, message) => {
      if (!req.session) return message;
      if (!req.session.flash) req.session.flash = emptyBag();
      const key = Object.prototype.hasOwnProperty.call(req.session.flash, type) ? type : 'info';
      req.session.flash[key].push(message);
      return message;
    };

    next();
  };
}

module.exports = { flashMiddleware, EMPTY };
