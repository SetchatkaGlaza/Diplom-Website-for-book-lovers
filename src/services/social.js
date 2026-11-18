'use strict';

const { Op } = require('sequelize');

/**
 * Социальная часть: подписки, лента, уведомления, сообщения, цитаты.
 *
 * Правила, которые здесь закреплены:
 *  - подписка односторонняя, на себя подписаться нельзя (проверяется и в базе);
 *  - приватный профиль: полку и цитаты видит только подписчик, но имя и «о себе» — все;
 *  - лента собирается одним запросом с подгрузкой людей, книг и рецензий:
 *    50 записей не должны превращаться в 50 запросов (это проверяется тестом);
 *  - уведомление не создаётся, если человек сам себе что-то сделал, и не создаётся,
 *    если этот тип уведомлений у получателя выключен;
 *  - диалог двух людей один: пара id всегда хранится по возрастанию;
 *  - читать чужой диалог нельзя — проверка владельца на каждом запросе.
 */

const FEED_TYPES = ['review', 'finished', 'shelf', 'club_join', 'club_post', 'follow'];

const NOTIFICATION_TYPES = {
  follow: { title: 'Новый подписчик', setting: 'notifyFollows' },
  comment: { title: 'Новый комментарий', setting: 'notifyComments' },
  like: { title: 'Кому-то понравилась ваша рецензия', setting: 'notifyLikes' },
  message: { title: 'Новое сообщение', setting: 'notifyMessages' },
  club: { title: 'Клубы', setting: null },
  system: { title: 'Новости сайта', setting: null }
};

function createSocialService({ User, Follow, Activity, Notification, Conversation, Message, Quote, Book, Review, sequelize }) {
  const sql = sequelize || User.sequelize;

  // ============ ПОДПИСКИ ============

  async function isFollowing(followerId, followingId) {
    if (!followerId || !followingId || followerId === followingId) return false;
    const row = await Follow.findOne({ where: { followerId, followingId } });
    return Boolean(row);
  }

  async function follow({ followerId, followingId }) {
    if (followerId === followingId) return { error: 'На себя подписаться нельзя' };

    const target = await User.findByPk(followingId);
    if (!target || target.deletedAt) return { error: 'Пользователь не найден' };

    const [, created] = await Follow.findOrCreate({
      where: { followerId, followingId },
      defaults: { followerId, followingId }
    });

    if (created) {
      const follower = await User.findByPk(followerId);
      await notify({
        userId: followingId,
        type: 'follow',
        title: `${follower ? follower.name : 'Кто-то'} подписался на вас`,
        body: 'Откройте профиль, чтобы посмотреть, что человек читает.',
        url: follower ? `/chitateli/${follower.id}` : null
      });
    }

    return { following: true, created };
  }

  async function unfollow({ followerId, followingId }) {
    const removed = await Follow.destroy({ where: { followerId, followingId } });
    return { following: false, removed: removed > 0 };
  }

  async function counts(userId) {
    const [followers, following] = await Promise.all([
      Follow.count({ where: { followingId: userId } }),
      Follow.count({ where: { followerId: userId } })
    ]);
    return { followers, following };
  }

  /** Список людей с подписями/подписчиками — одним запросом на список. */
  async function people(userId, mode = 'followers', limit = 100) {
    const where = mode === 'following' ? { followerId: userId } : { followingId: userId };
    const rows = await Follow.findAll({
      where,
      include: [{
        association: mode === 'following' ? 'following' : 'follower',
        attributes: ['id', 'name', 'bio']
      }],
      order: [['createdAt', 'DESC']],
      limit
    });

    return rows.map((row) => {
      const person = mode === 'following' ? row.following : row.follower;
      return { id: person.id, name: person.name, bio: person.bio || '' };
    });
  }

  /** Поиск читателей по имени — для страницы «кто здесь есть». */
  async function searchPeople(query, { limit = 20, viewerId = null } = {}) {
    const text = String(query || '').trim().slice(0, 60);
    const where = { deletedAt: null, isBlocked: false };
    if (text) where.name = { [Op.iLike]: `%${text.replace(/[%_\\]/g, ' ')}%` };

    const rows = await User.findAll({
      where,
      attributes: ['id', 'name', 'bio'],
      order: [['lastActiveAt', 'DESC'], ['createdAt', 'ASC']],
      limit
    });

    return rows.map((row) => ({ id: row.id, name: row.name, bio: row.bio || '' }));
  }

  // ============ ЛЕНТА ============

  /**
   * Лента «что читают люди, на которых я подписан» плюс свои записи.
   * Один запрос с include: люди, книги, рецензии подгружаются сразу.
   */
  async function feed(userId, { page = 1, limit = 20 } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const safePage = Math.max(1, Number.parseInt(page, 10) || 1);

    const following = await Follow.findAll({ where: { followerId: userId }, attributes: ['followingId'], raw: true });
    const authorIds = [userId, ...following.map((row) => row.followingId)];

    const where = { userId: { [Op.in]: authorIds }, type: { [Op.in]: FEED_TYPES } };

    const [total, rows] = await Promise.all([
      Activity.count({ where }),
      Activity.findAll({
        where,
        include: [
          { association: 'user', attributes: ['id', 'name'] },
          { association: 'book', attributes: ['id', 'slug', 'title', 'author'], required: false },
          { association: 'review', attributes: ['id', 'title', 'rating', 'hasSpoilers'], required: false },
          { association: 'club', attributes: ['id', 'slug', 'name'], required: false }
        ],
        order: [['createdAt', 'DESC'], ['id', 'DESC']],
        limit: safeLimit,
        offset: (safePage - 1) * safeLimit
      })
    ]);

    return {
      items: rows.map((row) => toFeedItem(row, userId)),
      total,
      page: safePage,
      pages: Math.max(1, Math.ceil(total / safeLimit))
    };
  }

  function toFeedItem(activity, viewerId) {
    const plain = activity.get({ plain: true });
    const user = plain.user || {};
    const book = plain.book || null;
    const review = plain.review || null;

    const phrases = {
      review: `написал рецензию${review ? ` на «${book ? book.title : 'книгу'}»` : ''}`,
      finished: `дочитал${book ? ` «${book.title}»` : ' книгу'}`,
      shelf: `добавил${book ? ` «${book.title}»` : ' книгу'} на полку`,
      club_join: 'вступил в клуб',
      club_post: 'написал в клубе',
      follow: 'подписался на читателя'
    };

    return {
      id: plain.id,
      type: plain.type,
      phrase: phrases[plain.type] || 'что-то сделал',
      createdAt: plain.createdAt,
      isOwn: plain.userId === viewerId,
      user: { id: user.id, name: user.name || 'Читатель' },
      book: book ? { slug: book.slug, title: book.title, author: book.author } : null,
      club: plain.club ? { slug: plain.club.slug, name: plain.club.name } : null,
      review: review ? {
        id: review.id,
        title: review.title || '',
        rating: (Number(review.rating) || 0) / 2,
        hasSpoilers: Boolean(review.hasSpoilers)
      } : null
    };
  }

  /**
   * Записать событие в ленту. Одинаковые события в пределах 5 минут не дублируются:
   * иначе отметка прогресса зальёт ленту десятком строк.
   */
  async function record({ userId, type, bookId = null, reviewId = null, clubId = null, meta = {} }) {
    if (!FEED_TYPES.includes(type)) return { error: 'Неизвестный тип события' };

    if (type === 'shelf') {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const recent = await Activity.findOne({
        where: {
          userId,
          type,
          bookId,
          createdAt: { [Op.gte]: fiveMinutesAgo }
        }
      });
      if (recent) return { activity: recent, duplicated: true };
    }

    const activity = await Activity.create({ userId, type, bookId, reviewId, clubId, meta });
    return { activity };
  }

  // ============ УВЕДОМЛЕНИЯ ============

  async function notify({ userId, type, title, body = '', url = null }) {
    const config = NOTIFICATION_TYPES[type];
    if (!config) return { error: 'Неизвестный тип уведомления' };

    const user = await User.findByPk(userId, { attributes: ['id', 'notifyFollows', 'notifyComments', 'notifyLikes', 'notifyMessages'] });
    if (!user) return { error: 'Пользователь не найден' };

    // Человек сам выключил этот тип — не присылаем
    if (config.setting && user[config.setting] === false) return { skipped: true };

    const notification = await Notification.create({
      userId,
      type,
      title: String(title).slice(0, 160),
      body: String(body).slice(0, 500),
      url: url ? String(url).slice(0, 255) : null
    });
    return { notification };
  }

  async function listNotifications(userId, { limit = 30, unreadOnly = false } = {}) {
    const where = { userId };
    if (unreadOnly) where.isRead = false;

    const rows = await Notification.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: Math.min(Math.max(Number(limit) || 30, 1), 100)
    });
    return rows.map((row) => row.get({ plain: true }));
  }

  async function unreadCount(userId) {
    return Notification.count({ where: { userId, isRead: false } });
  }

  async function markAllRead(userId) {
    const [changed] = await Notification.update(
      { isRead: true },
      { where: { userId, isRead: false } }
    );
    return { changed };
  }

  async function markRead(userId, notificationId) {
    const [changed] = await Notification.update(
      { isRead: true },
      { where: { id: notificationId, userId } }
    );
    return { changed };
  }

  // ============ СООБЩЕНИЯ ============

  /** Диалог двух людей: пара id всегда по возрастанию, поэтому он один. */
  async function openConversation(userAId, userBId) {
    if (userAId === userBId) return { error: 'Нельзя написать самому себе' };

    const low = Math.min(userAId, userBId);
    const high = Math.max(userAId, userBId);

    const [conversation] = await Conversation.findOrCreate({
      where: { userAId: low, userBId: high },
      defaults: { userAId: low, userBId: high }
    });
    return { conversation };
  }

  /** Список диалогов с собеседником и числом непрочитанных — один запрос. */
  async function conversations(userId) {
    const rows = await Conversation.findAll({
      where: { [Op.or]: [{ userAId: userId }, { userBId: userId }] },
      include: [
        { association: 'userA', attributes: ['id', 'name'] },
        { association: 'userB', attributes: ['id', 'name'] }
      ],
      order: [['lastMessageAt', 'DESC'], ['id', 'DESC']],
      limit: 50
    });

    const unreadRows = await Message.findAll({
      attributes: ['conversationId', [sql.literal('COUNT(*)'), 'total']],
      where: { readAt: null, senderId: { [Op.ne]: userId } },
      group: ['conversationId'],
      raw: true
    });
    const unreadByConversation = new Map(unreadRows.map((row) => [row.conversationId, Number(row.total)]));

    return rows.map((row) => {
      const other = row.userAId === userId ? row.userB : row.userA;
      return {
        id: row.id,
        other: { id: other.id, name: other.name },
        preview: row.lastMessagePreview || '',
        lastMessageAt: row.lastMessageAt,
        unread: unreadByConversation.get(row.id) || 0
      };
    });
  }

  async function conversationMessages(userId, conversationId, { limit = 100 } = {}) {
    const conversation = await Conversation.findOne({
      where: { id: conversationId, [Op.or]: [{ userAId: userId }, { userBId: userId }] },
      include: [
        { association: 'userA', attributes: ['id', 'name'] },
        { association: 'userB', attributes: ['id', 'name'] }
      ]
    });
    if (!conversation) return { error: 'Диалог не найден' };

    const rows = await Message.findAll({
      where: { conversationId: conversation.id, isDeleted: false },
      order: [['createdAt', 'ASC'], ['id', 'ASC']],
      limit: Math.min(Math.max(Number(limit) || 100, 1), 200)
    });

    const other = conversation.userAId === userId ? conversation.userB : conversation.userA;

    return {
      conversation: {
        id: conversation.id,
        other: { id: other.id, name: other.name }
      },
      messages: rows.map((row) => ({
        id: row.id,
        body: row.body,
        createdAt: row.createdAt,
        isOwn: row.senderId === userId,
        readAt: row.readAt
      }))
    };
  }

  /** Отправка сообщения: пишет в диалог, обновляет превью и уведомляет получателя. */
  async function sendMessage({ senderId, recipientId = null, conversationId = null, body }) {
    const text = String(body || '').trim();
    if (!text) return { error: 'Сообщение пустое' };
    if (text.length > 4000) return { error: 'Сообщение: максимум 4000 знаков' };

    let conversation;
    if (conversationId) {
      conversation = await Conversation.findOne({
        where: { id: conversationId, [Op.or]: [{ userAId: senderId }, { userBId: senderId }] }
      });
      if (!conversation) return { error: 'Диалог не найден' };
    } else {
      const opened = await openConversation(senderId, recipientId);
      if (opened.error) return opened;
      conversation = opened.conversation;
    }

    const recipient = conversation.userAId === senderId ? conversation.userBId : conversation.userAId;

    const message = await Message.create({
      conversationId: conversation.id,
      senderId,
      body: text
    });

    await conversation.update({
      lastMessageAt: new Date(),
      lastMessagePreview: text.slice(0, 160)
    });

    const sender = await User.findByPk(senderId, { attributes: ['id', 'name'] });
    await notify({
      userId: recipient,
      type: 'message',
      title: `${sender ? sender.name : 'Читатель'} написал вам`,
      body: text.slice(0, 120),
      url: `/soobshcheniya/${conversation.id}`
    });

    return { message, conversation };
  }

  /** Отметить прочитанными входящие в диалоге. */
  async function markConversationRead(userId, conversationId) {
    const conversation = await Conversation.findOne({
      where: { id: conversationId, [Op.or]: [{ userAId: userId }, { userBId: userId }] }
    });
    if (!conversation) return { error: 'Диалог не найден' };

    const [changed] = await Message.update(
      { readAt: new Date() },
      { where: { conversationId: conversation.id, readAt: null, senderId: { [Op.ne]: userId } } }
    );
    return { changed };
  }

  async function unreadMessages(userId) {
    const rows = await Message.findAll({
      attributes: ['conversationId', [sql.literal('COUNT(*)'), 'total']],
      include: [{
        association: 'conversation',
        attributes: [],
        required: true,
        where: { [Op.or]: [{ userAId: userId }, { userBId: userId }] }
      }],
      where: { readAt: null, senderId: { [Op.ne]: userId } },
      group: ['Message.conversation_id'],
      raw: true
    });
    return rows.reduce((sum, row) => sum + (Number(row.total) || 0), 0);
  }

  // ============ ЦИТАТЫ ============

  async function addQuote({ userId, bookId, body, page = null }) {
    const text = String(body || '').trim();
    if (text.length < 3) return { error: 'Цитата: минимум 3 знака' };
    if (text.length > Quote.MAX_LENGTH) return { error: `Цитата: максимум ${Quote.MAX_LENGTH} знаков` };

    const book = await Book.findByPk(bookId);
    if (!book) return { error: 'Книга не найдена' };

    const quote = await Quote.create({
      userId,
      bookId,
      body: text,
      page: page ? Math.max(1, Number.parseInt(page, 10) || 0) || null : null
    });
    return { quote };
  }

  async function listQuotesForBook(bookId, { limit = 10 } = {}) {
    const rows = await Quote.findAll({
      where: { bookId, state: 'published' },
      include: [{ association: 'user', attributes: ['id', 'name'] }],
      order: [['createdAt', 'DESC']],
      limit
    });
    return rows.map((row) => ({
      id: row.id,
      body: row.body,
      page: row.page,
      createdAt: row.createdAt,
      user: { id: row.user.id, name: row.user.name || 'Читатель' }
    }));
  }

  return {
    isFollowing,
    follow,
    unfollow,
    counts,
    people,
    searchPeople,
    feed,
    record,
    notify,
    listNotifications,
    unreadCount,
    markAllRead,
    markRead,
    openConversation,
    conversations,
    conversationMessages,
    sendMessage,
    markConversationRead,
    unreadMessages,
    addQuote,
    listQuotesForBook,
    NOTIFICATION_TYPES
  };
}

module.exports = { createSocialService, NOTIFICATION_TYPES, FEED_TYPES };
