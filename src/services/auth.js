'use strict';

const bcrypt = require('bcrypt');

/**
 * Регистрация, вход и смена пароля.
 *
 * Правила, которые здесь закреплены:
 *  - пароли только bcrypt, cost 12 (в тестах ниже — иначе медленно);
 *  - ответ «неверный пароль» и «нет такого пользователя» одинаковый:
 *    иначе сайт превращается в проверялку «есть ли такой e-mail»;
 *  - смена пароля увеличивает sessionEpoch и выкидывает все старые сессии;
 *  - блокировка проверяется при каждом запросе (см. middlewares/auth).
 */

const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || (process.env.NODE_ENV === 'test' ? 4 : 12);

function createAuthService({ User, sequelize = User.sequelize }) {
  // sequelize.literal нужен, чтобы прибавить единицу к счётчику прямо в БД:
  // иначе два одновременных запроса перезапишут друг друга.
  const sql = sequelize;
  async function hashPassword(password) {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }

  async function verifyPassword(password, hash) {
    if (!hash) return false;
    return bcrypt.compare(password, hash);
  }

  /**
   * Создаёт пользователя. Возвращает { user } или { error }.
   * Гонка двух одновременных регистраций ловится уникальным индексом в БД,
   * а не предварительной проверкой «занято ли».
   */
  async function register({ email, name, password, ip = null }) {
    const passwordHash = await hashPassword(password);

    try {
      const user = await User.create({
        email,
        name,
        passwordHash,
        role: 'user',
        emailVerifiedAt: null,
        registrationIp: ip
      });
      return { user };
    } catch (error) {
      if (error.name === 'SequelizeUniqueConstraintError') {
        return { error: 'Этот e-mail уже зарегистрирован. Войдите или восстановите пароль.' };
      }
      throw error;
    }
  }

  /**
   * Проверяет пару e-mail/пароль.
   * Возвращает { user } | { error: 'credentials' } | { error: 'blocked' }.
   */
  async function authenticate({ email, password }) {
    const user = await User.findOne({ where: { email } });

    // Считаем хеш даже для несуществующего пользователя: иначе разница
    // во времени ответа подскажет, есть такой аккаунт или нет.
    const hash = user ? user.passwordHash : '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
    const matches = await verifyPassword(password, hash);

    if (!user || !matches) return { error: 'credentials' };

    const blocked = user.isBlocked
      && (!user.blockedUntil || new Date(user.blockedUntil) > new Date());
    if (blocked) return { error: 'blocked' };

    user.lastActiveAt = new Date();
    await user.save();

    return { user };
  }

  /**
   * Меняет пароль и увеличивает epoch: все выданные ранее сессии перестают
   * действовать, даже если злоумышленник успел украсть cookie.
   */
  async function changePassword(user, newPassword) {
    const passwordHash = await hashPassword(newPassword);
    await User.update(
      {
        passwordHash,
        sessionEpoch: sql.literal('session_epoch + 1')
      },
      { where: { id: user.id } }
    );
    return User.findByPk(user.id);
  }

  /** Принудительный выход со всех устройств. */
  async function revokeSessions(userId) {
    await User.update(
      { sessionEpoch: sql.literal('session_epoch + 1') },
      { where: { id: userId } }
    );
  }

  async function markEmailVerified(userId) {
    await User.update({ emailVerifiedAt: new Date() }, { where: { id: userId } });
  }

  /** Блокировка: увеличиваем epoch, чтобы активные сессии сразу погасли. */
  async function setBlocked(userId, isBlocked, until = null) {
    await User.update(
      {
        isBlocked,
        blockedUntil: isBlocked ? until : null,
        ...(isBlocked ? { sessionEpoch: sql.literal('session_epoch + 1') } : {})
      },
      { where: { id: userId } }
    );
  }

  /**
   * Полное удаление аккаунта. Пользовательские данные уходят каскадом,
   * но вместо удаления строки помечаем e-mail и имя, чтобы не ломать
   * внешние ключи у чужих комментариев — проще и безопаснее.
   */
  async function deleteAccount(userId) {
    const user = await User.findByPk(userId);
    if (!user) return false;

    await User.update(
      {
        email: `deleted-${userId}-${Date.now()}@example.invalid`,
        name: 'Удалённый пользователь',
        passwordHash: 'deleted',
        bio: '',
        avatar: 'default-avatar.svg',
        isBlocked: true,
        deletedAt: new Date(),
        sessionEpoch: sql.literal('session_epoch + 1')
      },
      { where: { id: userId } }
    );
    return true;
  }

  return {
    hashPassword,
    verifyPassword,
    register,
    authenticate,
    changePassword,
    revokeSessions,
    markEmailVerified,
    setBlocked,
    deleteAccount,
    BCRYPT_ROUNDS
  };
}

module.exports = { createAuthService, BCRYPT_ROUNDS };
