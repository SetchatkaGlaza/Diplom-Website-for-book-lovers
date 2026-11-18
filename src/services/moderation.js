'use strict';

const { Op } = require('sequelize');

/**
 * Модерация: жалобы, автофильтры, блокировки, журнал действий.
 *
 * Принципы:
 *  - жалоба не удаляет контент сама по себе: пока модератор не решил, текст
 *    остаётся, но попадает в очередь;
 *  - автоматика только подсказывает: фильтр ссылок и повторов возвращает
 *    вердикт, а не блокирует аккаунт молча;
 *  - каждое действие модератора оставляет строку в журнале — без этого
 *    невозможно разобрать «почему меня заблокировали»;
 *  - новые аккаунты ограничены: у них нет права писать чаще, чем раз в минуту,
 *    и ссылки в первых сообщениях запрещены.
 */

const TRUST_LEVELS = {
  0: { label: 'Новичок', postsPerHour: 5, canPostLinks: false, canComment: true },
  1: { label: 'Читатель', postsPerHour: 20, canPostLinks: false, canComment: true },
  2: { label: 'Старожил', postsPerHour: 60, canPostLinks: true, canComment: true },
  3: { label: 'Хранитель', postsPerHour: 120, canPostLinks: true, canComment: true }
};

const REASONS = [
  { key: 'spam', label: 'Спам или реклама' },
  { key: 'rudeness', label: 'Грубость, оскорбления' },
  { key: 'spoiler', label: 'Спойлер без предупреждения' },
  { key: 'copyright', label: 'Нарушение авторских прав' },
  { key: 'other', label: 'Другое' }
];

const URL_PATTERN = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(?:ru|com|net|org|io|me|xyz|top|site|shop)\b)/i;
const SPAM_WORDS = /(казино|заработок без вложений|кредит без отказа|купить диплом|накрутка подписчиков|viagra|casino)/i;

function createModerationService({
  Report, Review, ReviewComment, ClubPost, User, Book, LibraryEntry, ModerationLog, sequelize
}) {
  const sql = sequelize || Report.sequelize;

  // ---------- Автоматика ----------

  /**
   * Проверка текста перед публикацией.
   * Возвращает { ok, level: 'clean'|'warning'|'reject', links, reasons }.
   */
  function checkText(text, { trustLevel = 0, field = 'сообщение' } = {}) {
    const value = String(text || '');
    const reasons = [];

    const hasLink = URL_PATTERN.test(value);
    if (hasLink && !TRUST_LEVELS[Math.min(3, Number(trustLevel) || 0)].canPostLinks) {
      reasons.push(`Ссылки в ${field}е доступны не сразу — сначала наберитесь истории`);
    }

    if (SPAM_WORDS.test(value)) reasons.push('Похоже на рекламу');

    // Повтор слова больше 8 раз подряд — обычно попытка залить экран
    if (/(\b\w+\b)(?:\s+\1){8,}/i.test(value)) reasons.push('Слишком много повторов одного слова');

    // Капс длиннее 40 символов подряд
    if (/[А-ЯЁA-Z]{40,}/.test(value)) reasons.push('Слишком много капса');

    return {
      ok: reasons.length === 0,
      level: reasons.length === 0 ? 'clean' : 'warning',
      links: hasLink,
      reasons
    };
  }

  /** Частотный лимит: сколько публикаций за последний час. */
  async function rateExceeded({ userId, model, limit }) {
    if (!userId) return false;
    const hourAgo = new Date(Date.now() - 3600 * 1000);
    const count = await model.count({ where: { userId, createdAt: { [Op.gte]: hourAgo } } });
    return count >= limit;
  }

  /** Проверка перед публикацией: и текст, и частота. */
  async function guard({ userId, text, model = Review, field = 'рецензии' }) {
    const user = await User.findByPk(userId, { attributes: ['id', 'trustLevel', 'isBlocked', 'blockedUntil'] });
    if (!user) return { ok: false, error: 'Пользователь не найден' };

    const blocked = user.isBlocked && (!user.blockedUntil || new Date(user.blockedUntil) > new Date());
    if (blocked) return { ok: false, error: 'Аккаунт заблокирован: публикация недоступна' };

    const level = TRUST_LEVELS[Math.min(3, Number(user.trustLevel) || 0)];
    const textCheck = checkText(text, { trustLevel: user.trustLevel, field });

    if (await rateExceeded({ userId, model, limit: level.postsPerHour })) {
      return { ok: false, error: `Слишком часто: для вашего уровня ${level.postsPerHour} публикаций в час` };
    }

    if (!textCheck.ok) return { ok: false, error: textCheck.reasons[0], reasons: textCheck.reasons };

    return { ok: true, trust: level };
  }

  // ---------- Жалобы ----------

  /** Сохранить жалобу. Один человек — одна жалоба на объект. */
  async function report({ reporterId, subjectType, subjectId, reason }) {
    const clean = String(reason || '').trim();
    if (clean.length < 5) return { error: 'Опишите причину жалобы: хотя бы 5 символов' };
    if (clean.length > 500) return { error: 'Слишком длинная причина: до 500 символов' };

    const allowed = ['review', 'comment', 'club_post', 'user'];
    if (!allowed.includes(subjectType)) return { error: 'Неизвестный тип жалобы' };

    const id = Number(subjectId);
    if (!Number.isInteger(id) || id <= 0) return { error: 'Неизвестный объект жалобы' };

    // Проверяем, что объект существует: иначе очередь забьётся пустыми жалобами
    const exists = await subjectExists(subjectType, id);
    if (!exists) return { error: 'Объект не найден' };

    const existing = await Report.findOne({
      where: { reporterId, subjectType, subjectId: id, state: 'open' }
    });
    if (existing) return { error: 'Вы уже пожаловались на это — жалоба в очереди', duplicate: true };

    const created = await Report.create({ reporterId, subjectType, subjectId: id, reason: clean });
    return { report: created };
  }

  async function subjectExists(type, id) {
    switch (type) {
      case 'review': return Boolean(await Review.findByPk(id));
      case 'comment': return Boolean(await ReviewComment.findByPk(id));
      case 'club_post': return Boolean(await ClubPost.findByPk(id));
      case 'user': return Boolean(await User.findByPk(id));
      default: return false;
    }
  }

  /** Жалоба вместе с объектом: модератору нужно видеть текст, а не только номер. */
  async function queue({ state = 'open', limit = 50 } = {}) {
    const reports = await Report.findAll({
      where: { state },
      include: [{ model: User, as: 'reporter', attributes: ['id', 'name'] }],
      order: [['createdAt', 'ASC']],
      limit: Math.min(100, Math.max(1, limit))
    });

    const items = [];
    for (const row of reports) {
      const plain = row.get({ plain: true });
      items.push({ ...plain, subject: await loadSubject(plain.subjectType, plain.subjectId) });
    }
    return items;
  }

  async function loadSubject(type, id) {
    if (type === 'review') {
      const review = await Review.findByPk(id, {
        include: [
          { model: User, as: 'user', attributes: ['id', 'name'] },
          { model: Book, as: 'book', attributes: ['id', 'slug', 'title'] }
        ]
      });
      if (!review) return null;
      return {
        title: review.title || `Рецензия на «${review.book ? review.book.title : 'книгу'}»`,
        text: review.body,
        author: review.user ? review.user.name : '—',
        url: review.book ? `/knigi/${review.book.slug}#review-${review.id}` : null,
        hidden: review.state === 'hidden'
      };
    }

    if (type === 'comment') {
      const comment = await ReviewComment.findByPk(id, {
        include: [{ model: User, as: 'user', attributes: ['id', 'name'] }]
      });
      if (!comment) return null;
      return { title: 'Комментарий', text: comment.body, author: comment.user ? comment.user.name : '—', url: null, hidden: comment.state === 'hidden' };
    }

    if (type === 'club_post') {
      const post = await ClubPost.findByPk(id, {
        include: [{ model: User, as: 'user', attributes: ['id', 'name'] }]
      });
      if (!post) return null;
      return { title: 'Сообщение в клубе', text: post.body, author: post.user ? post.user.name : '—', url: null, hidden: post.state === 'hidden' };
    }

    if (type === 'user') {
      const user = await User.findByPk(id, { attributes: ['id', 'name', 'bio', 'isBlocked'] });
      if (!user) return null;
      return { title: `Профиль: ${user.name}`, text: user.bio || '', author: user.name, url: `/chitateli/${user.id}`, hidden: user.isBlocked };
    }

    return null;
  }

  /**
   * Решение по жалобе.
   *  action = 'hide' — скрыть контент (рецензии и посты получают state='hidden');
   *  action = 'block' — заблокировать автора;
   *  action = 'reject' — жалоба не подтвердилась.
   */
  async function resolve({ reportId, moderatorId, action, note = '' }) {
    const report = await Report.findByPk(reportId);
    if (!report) return { error: 'Жалоба не найдена', status: 404 };
    if (report.state !== 'open') return { error: 'Жалоба уже рассмотрена', status: 409 };

    const resolved = {
      state: action === 'reject' ? 'rejected' : 'resolved',
      resolvedByUserId: moderatorId,
      resolutionNote: String(note || '').slice(0, 500)
    };

    let affected = null;

    if (action === 'hide' || action === 'block') {
      affected = await hideSubject(report.subjectType, report.subjectId);
      if (action === 'block') {
        const authorId = await subjectAuthor(report.subjectType, report.subjectId);
        if (authorId) {
          await blockUser({ userId: authorId, moderatorId, days: 7, reason: note || 'Нарушение правил' });
        }
      }
    }

    await report.update(resolved);
    await log({ actorId: moderatorId, action: `report.${action}`, subjectType: report.subjectType, subjectId: report.subjectId, note });
    return { resolved: true, affected };
  }

  async function subjectAuthor(type, id) {
    const model = { review: Review, comment: ReviewComment, club_post: ClubPost, user: User }[type];
    if (!model) return null;
    const row = await model.findByPk(id, { attributes: type === 'user' ? ['id'] : ['userId'] });
    if (!row) return null;
    return type === 'user' ? row.id : row.userId;
  }

  /** Скрытие контента. Книги не скрываем: жалоба на книгу — это вопрос к каталогу. */
  async function hideSubject(type, id) {
    if (type === 'review') {
      const review = await Review.findByPk(id);
      if (review) {
        await review.update({ state: 'hidden' });
        await recountBook(review.bookId);
        return 'review';
      }
    }
    if (type === 'comment') {
      const comment = await ReviewComment.findByPk(id);
      if (comment) {
        await comment.update({ state: 'hidden' });
        return 'comment';
      }
    }
    if (type === 'club_post') {
      const post = await ClubPost.findByPk(id);
      if (post) {
        await post.update({ state: 'hidden' });
        return 'club_post';
      }
    }
    if (type === 'user') {
      await blockUser({ userId: id, moderatorId: null, days: 7, reason: 'Жалоба на профиль' });
      return 'user';
    }
    return null;
  }

  /** Пересчёт среднего рейтинга книги после скрытия рецензии. */
  async function recountBook(bookId) {
    if (!bookId) return;
    await sql.query(
      `UPDATE books SET
         ratings_count = (SELECT COUNT(*) FROM reviews r WHERE r.book_id = :id AND r.state = 'published'),
         ratings_sum = (SELECT COALESCE(SUM(r.rating), 0) FROM reviews r WHERE r.book_id = :id AND r.state = 'published')
       WHERE id = :id`,
      { replacements: { id: bookId } }
    );
  }

  // ---------- Блокировки ----------

  /** Блокировка: увеличиваем session_epoch — активные сессии гаснут сразу. */
  async function blockUser({ userId, moderatorId = null, days = 7, reason = '' }) {
    const user = await User.findByPk(userId);
    if (!user) return { error: 'Пользователь не найден', status: 404 };
    if (['admin', 'moderator'].includes(user.role)) {
      return { error: 'Модератора и администратора блокировать нельзя', status: 403 };
    }

    const until = days ? new Date(Date.now() + Math.min(3650, Math.max(1, days)) * 86400000) : null;
    await User.update(
      { isBlocked: true, blockedUntil: until, sessionEpoch: sql.literal('"session_epoch" + 1') },
      { where: { id: userId } }
    );

    await log({ actorId: moderatorId, action: 'user.block', subjectType: 'user', subjectId: userId, note: reason, meta: { days } });
    return { blocked: true, until };
  }

  async function unblockUser({ userId, moderatorId }) {
    await User.update({ isBlocked: false, blockedUntil: null }, { where: { id: userId } });
    await log({ actorId: moderatorId, action: 'user.unblock', subjectType: 'user', subjectId: userId });
    return { unblocked: true };
  }

  /** Блокировка кончилась — пускаем автоматически (иначе человек ждёт модератора). */
  async function liftExpired() {
    const now = new Date();
    const [affected] = await User.update(
      { isBlocked: false, blockedUntil: null },
      { where: { isBlocked: true, blockedUntil: { [Op.ne]: null, [Op.lte]: now } } }
    );
    return affected || 0;
  }

  /** Обход блокировки: та же почта или тот же браузер/IP — не повод пускать. */
  async function isBlocked(userId) {
    const user = await User.findByPk(userId, { attributes: ['isBlocked', 'blockedUntil'] });
    if (!user) return true;
    if (!user.isBlocked) return false;
    if (user.blockedUntil && new Date(user.blockedUntil) <= new Date()) return false;
    return true;
  }

  // ---------- Уровни доверия ----------

  /** Пересчёт уровня: по числу закрытых книг и рецензий. */
  async function recalcTrust(userId) {
    const [entries, reviews, comments] = await Promise.all([
      LibraryEntry.count({ where: { userId, status: 'read' } }),
      Review.count({ where: { userId, state: 'published' } }),
      ReviewComment.count({ where: { userId, state: 'published' } })
    ]);

    let level = 0;
    if (entries >= 3 || reviews >= 1) level = 1;
    if (entries >= 15 && reviews >= 3) level = 2;
    if (entries >= 50 && reviews >= 10 && comments >= 20) level = 3;

    await User.update({ trustLevel: level }, { where: { id: userId } });
    return { level, entries, reviews, comments };
  }

  // ---------- Журнал ----------

  async function log({ actorId, action, subjectType = null, subjectId = null, note = '', meta = {} }) {
    if (!ModerationLog) return false;
    await ModerationLog.create({
      actorId: actorId || null,
      action,
      subjectType,
      subjectId,
      note: String(note || '').slice(0, 500),
      meta
    });
    return true;
  }

  /** Журнал: кто, что и когда сделал. Читают только модераторы и админ. */
  async function history({ limit = 50 } = {}) {
    if (!ModerationLog) return [];
    const rows = await ModerationLog.findAll({
      include: [{ model: User, as: 'actor', attributes: ['id', 'name'], required: false }],
      order: [['createdAt', 'DESC']],
      limit: Math.min(200, Math.max(1, limit))
    });
    return rows.map((row) => {
      const plain = row.get({ plain: true });
      return {
        id: plain.id,
        action: plain.action,
        subjectType: plain.subjectType,
        subjectId: plain.subjectId,
        note: plain.note,
        createdAt: plain.createdAt,
        actorName: plain.actor ? plain.actor.name : 'система',
        meta: plain.meta
      };
    });
  }

  // ---------- Юридическое ----------

  /**
   * Жалоба правообладателя: отдельный поток, не путается с обычными жалобами.
   * Пишем в reports как subjectType = 'review' с причиной copyright? Нет:
   * правообладатель не всегда зарегистрирован, поэтому храним в отдельном
   * месте — в метаданных журнала, чтобы не требовать аккаунта.
   */
  async function copyrightClaim({ name, email, subject, text }) {
    const errors = {};
    const cleanName = String(name || '').trim();
    const cleanEmail = String(email || '').trim();
    const cleanSubject = String(subject || '').trim();
    const cleanText = String(text || '').trim();

    if (cleanName.length < 2) errors.name = 'Укажите имя или организацию';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail)) errors.email = 'Нужен рабочий e-mail для ответа';
    if (cleanSubject.length < 5) errors.subject = 'Что именно нарушает права: название книги или ссылка';
    if (cleanText.length < 30) errors.text = 'Опишите ситуацию подробнее: минимум 30 символов';

    if (Object.keys(errors).length) return { errors };

    const claim = {
      name: cleanName.slice(0, 120),
      email: cleanEmail.slice(0, 254),
      subject: cleanSubject.slice(0, 200),
      text: cleanText.slice(0, 2000),
      receivedAt: new Date().toISOString()
    };

    // Обращение правообладателя живёт в журнале модерации: аккаунт ему не нужен
    await log({ actorId: null, action: 'copyright.claim', subjectType: 'copyright', subjectId: null, note: claim.subject, meta: claim });

    return { claim };
  }

  /**
   * Обратная связь во время беты.
   *
   * Отдельно от жалобы на контент: жалоба — «нарушает правила», обратная
   * связь — «мне неудобно пользоваться». Вторая важнее на старте, потому что
   * показывает не нарушителей, а места, где люди бросают.
   */
  async function feedback({ name, email, kind, text, page }) {
    const errors = {};
    const cleanName = String(name || '').trim();
    const cleanEmail = String(email || '').trim();
    const cleanText = String(text || '').trim();
    const cleanPage = String(page || '').trim().slice(0, 300);

    const KINDS = ['неудобно', 'ошибка', 'идея', 'другое'];
    const cleanKind = KINDS.includes(kind) ? kind : 'другое';

    if (cleanName.length < 2) errors.name = 'Как к вам обращаться';
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail)) {
      errors.email = 'Похоже, в адресе опечатка';
    }
    if (cleanText.length < 20) errors.text = 'Напишите чуть подробнее: минимум 20 символов';
    if (cleanText.length > 4000) errors.text = 'Слишком длинно: до 4000 символов';

    if (Object.keys(errors).length) return { errors };

    const entry = {
      name: cleanName.slice(0, 120),
      email: cleanEmail.slice(0, 254),
      kind: cleanKind,
      text: cleanText.slice(0, 4000),
      page: cleanPage,
      receivedAt: new Date().toISOString()
    };

    await log({
      actorId: null,
      action: 'feedback.create',
      subjectType: 'feedback',
      subjectId: null,
      note: `${cleanKind}: ${cleanText.slice(0, 200)}`,
      meta: entry
    });

    return { entry };
  }

  async function feedbackList({ limit = 100 } = {}) {
    if (!ModerationLog) return [];
    const rows = await ModerationLog.findAll({
      where: { action: 'feedback.create' },
      order: [['createdAt', 'DESC']],
      limit: Math.min(500, Math.max(1, limit))
    });
    return rows.map((row) => ({ id: row.id, createdAt: row.createdAt, ...(row.meta || {}) }));
  }

  async function copyrightClaims({ limit = 50 } = {}) {
    if (!ModerationLog) return [];
    const rows = await ModerationLog.findAll({
      where: { action: 'copyright.claim' },
      order: [['createdAt', 'DESC']],
      limit: Math.min(200, Math.max(1, limit))
    });
    return rows.map((row) => ({ id: row.id, createdAt: row.createdAt, ...(row.meta || {}) }));
  }

  return {
    checkText,
    guard,
    rateExceeded,
    report,
    queue,
    resolve,
    loadSubject,
    hideSubject,
    recountBook,
    blockUser,
    unblockUser,
    liftExpired,
    isBlocked,
    recalcTrust,
    log,
    history,
    copyrightClaim,
    feedback,
    feedbackList,
    copyrightClaims,
    TRUST_LEVELS,
    REASONS
  };
}

module.exports = { createModerationService, TRUST_LEVELS, REASONS };
