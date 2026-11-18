'use strict';

const crypto = require('crypto');
const { Op } = require('sequelize');

/**
 * Одноразовые токены (подтверждение почты, сброс пароля).
 *
 * В базе лежит только SHA-256 токена. Сравнение — timing-safe.
 * Сроки: подтверждение почты 48 часов, сброс пароля 1 час.
 * Повторный запрос гасит предыдущие токены того же типа.
 */

const TTL = {
  verify_email: 48 * 60 * 60 * 1000,
  reset_password: 60 * 60 * 1000
};

function hash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function generate() {
  return crypto.randomBytes(32).toString('hex');
}

function createTokenService({ Token }) {
  /** Выпускает новый токен и гасит старые того же типа. */
  async function issue(userId, type) {
    if (!Token.TYPES.includes(type)) throw new Error(`Неизвестный тип токена: ${type}`);

    await Token.update(
      { usedAt: new Date() },
      { where: { userId, type, usedAt: null } }
    );

    const token = generate();
    await Token.create({
      userId,
      type,
      tokenHash: hash(token),
      expiresAt: new Date(Date.now() + TTL[type])
    });

    return token;
  }

  /**
   * Проверяет токен и, если ok, помечает использованным.
   * Возвращает { ok: true, userId } или { ok: false, reason }.
   */
  async function consume(token, type) {
    if (!token || typeof token !== 'string' || token.length !== 64) {
      return { ok: false, reason: 'format' };
    }

    const record = await Token.findOne({ where: { type, tokenHash: hash(token) } });
    if (!record) return { ok: false, reason: 'not_found' };
    if (record.usedAt) return { ok: false, reason: 'used' };
    if (new Date(record.expiresAt) <= new Date()) return { ok: false, reason: 'expired' };

    record.usedAt = new Date();
    await record.save();
    return { ok: true, userId: record.userId };
  }

  /** Проверка без гашения: нужно, чтобы показать форму смены пароля. */
  async function peek(token, type) {
    if (!token || typeof token !== 'string' || token.length !== 64) return null;
    const record = await Token.findOne({
      where: {
        type,
        tokenHash: hash(token),
        usedAt: null,
        expiresAt: { [Op.gt]: new Date() }
      }
    });
    return record ? { userId: record.userId } : null;
  }

  /** Удаление просроченных токенов — вызывать по расписанию. */
  async function pruneExpired(now = new Date()) {
    return Token.destroy({ where: { expiresAt: { [Op.lt]: now } } });
  }

  return { issue, consume, peek, pruneExpired, hash, TTL };
}

module.exports = { createTokenService, hash, generate, TTL };
