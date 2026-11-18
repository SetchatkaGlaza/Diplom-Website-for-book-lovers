'use strict';

const crypto = require('crypto');

/**
 * Идентификатор запроса: попадает в лог и в заголовок X-Request-Id.
 * По нему можно найти все записи о конкретной ошибке.
 */
function requestId() {
  return function attachRequestId(req, res, next) {
    const incoming = req.get('x-request-id');
    req.id = /^[A-Za-z0-9-]{8,64}$/.test(incoming || '') ? incoming : crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  };
}

module.exports = { requestId };
