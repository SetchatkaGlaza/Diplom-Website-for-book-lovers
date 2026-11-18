'use strict';

const crypto = require('node:crypto');
const { Op } = require('sequelize');
const { slugify, uniqueSlug } = require('../lib/slug');

/**
 * Клубы: создание, роли, заявки, главы и приглашения.
 *
 * Ключевые правила безопасности (их проверяют тесты):
 *  - редактировать клуб может только владелец или модератор сайта;
 *  - закрытый клуб не показывает посты тому, кто не участник;
 *  - пост со спойлерами по главе N не отдаётся читателю, который ещё на главе N−1;
 *  - приглашение одноразовое и не срабатывает после исчерпания или истечения.
 *
 * Права собраны в одном месте — `can()`: так нельзя случайно забыть проверку
 * в новом маршруте и открыть чужие данные.
 */

const ROLES = ['member', 'moderator', 'owner'];
const LIMITS = {
  name: { min: 3, max: 120 },
  description: { min: 10, max: 2000 },
  post: { min: 2, max: 8000 },
  request: { max: 300 },
  chapter: { min: 1, max: 2000 },
  schedule: 40
};

const ROLE_LABELS = { owner: 'владелец', moderator: 'модератор', member: 'участник', lead: 'ведущий' };

/** Человекопонятная ошибка в том же формате, что у остальных сервисов. */
function fail(error, status = 400) {
  return { error, status };
}

function createClubService({
  Club, ClubMember, ClubPost, ClubRequest, ClubInvite, ClubSchedule,
  Book, User, LibraryEntry, Notification, Activity, sequelize
}) {
  const sql = sequelize || Club.sequelize;

  /** Клуб по слагу + участие текущего человека. */
  async function find(slug) {
    if (!slug) return null;
    return Club.findOne({ where: { slug: String(slug).toLowerCase() } });
  }

  async function membership(clubId, userId) {
    if (!clubId || !userId) return null;
    return ClubMember.findOne({ where: { clubId, userId } });
  }

  async function isStaff(userId) {
    if (!userId) return false;
    const user = await User.findByPk(userId, { attributes: ['id', 'role'] });
    return Boolean(user && ['moderator', 'admin', 'editor'].includes(user.role));
  }

  /**
   * Права на действие. Возвращает объект с флагами — шаблоны используют его же,
   * поэтому кнопки «Редактировать» и проверки на сервере не расходятся.
   */
  async function can(club, userId, { isSiteStaff = false } = {}) {
    const role = userId ? (await membership(club.id, userId))?.role || null : null;
    const isOwner = Boolean(userId && club.ownerId === userId);
    const isModerator = role === 'moderator' || role === 'lead';
    const isMember = Boolean(role);

    return {
      role,
      isOwner,
      isMember,
      // Редактировать клуб: владелец или модератор клуба, плюс модерация сайта
      canEdit: isOwner || isModerator || isSiteStaff,
      canManageRoles: isOwner || isSiteStaff,
      canModerate: isOwner || isModerator || isSiteStaff,
      canPost: isMember,
      canJoin: !isMember && !club.isPrivate,
      canRequest: !isMember && club.isPrivate,
      canLeave: isMember && !isOwner
    };
  }

  /** Создание клуба: автор сразу владелец и участник. */
  async function create({ ownerId, name, description, isPrivate = false, cover = 'default-club.svg' }) {
    const cleanName = String(name || '').replace(/\s+/g, ' ').trim();
    const cleanDescription = String(description || '').trim();

    if (cleanName.length < LIMITS.name.min) return fail(`Название: минимум ${LIMITS.name.min} символа`);
    if (cleanName.length > LIMITS.name.max) return fail(`Название: максимум ${LIMITS.name.max} символов`);
    if (cleanDescription.length < LIMITS.description.min) {
      return fail(`Описание: минимум ${LIMITS.description.min} символов — расскажите, о чём клуб`);
    }
    if (cleanDescription.length > LIMITS.description.max) {
      return fail(`Описание: максимум ${LIMITS.description.max} символов`);
    }

    const slug = await uniqueSlug(cleanName, async (candidate) => Boolean(await Club.findOne({ where: { slug: candidate } })), 'klub');

    const club = await Club.create({
      slug,
      name: cleanName,
      description: cleanDescription,
      cover: cover || 'default-club.svg',
      ownerId,
      isPrivate: Boolean(isPrivate),
      membersCount: 1,
      postsCount: 0,
      lastActivityAt: new Date()
    });

    await ClubMember.create({ clubId: club.id, userId: ownerId, role: 'owner' });

    if (Activity) {
      await Activity.create({ userId: ownerId, type: 'club_join', clubId: club.id, meta: { created: true } });
    }

    return { club };
  }

  /** Список клубов: открытые всегда, закрытые — если вы участник или владелец. */
  async function list({ userId = null, search = '', limit = 24, offset = 0 } = {}) {
    const where = {};
    if (search.trim()) {
      const needle = `%${search.trim()}%`;
      where[Op.or] = [{ name: { [Op.iLike]: needle } }, { description: { [Op.iLike]: needle } }];
    }

    const clubs = await Club.findAll({
      where,
      include: [{ model: User, as: 'owner', attributes: ['id', 'name'] }],
      order: [['lastActivityAt', 'DESC'], ['id', 'DESC']],
      limit: Math.min(60, Math.max(1, limit)),
      offset: Math.max(0, offset)
    });

    const myMemberships = userId
      ? await ClubMember.findAll({ where: { userId }, attributes: ['clubId', 'role'], raw: true })
      : [];
    const membershipMap = new Map(myMemberships.map((row) => [row.clubId, row.role]));

    const items = clubs.map((club) => ({
      ...club.get({ plain: true }),
      myRole: membershipMap.get(club.id) || null,
      locked: club.isPrivate && !membershipMap.has(club.id)
    }));

    // Закрытые клубы чужим не показываем вовсе — иначе видно названия
    return items.filter((club) => !club.locked);
  }

  /** Карточка клуба: пост-лента с защитой спойлеров по главе читателя. */
  async function detail({ slug, viewerId = null, viewerChapter = null }) {
    const club = await find(slug);
    if (!club) return fail('Клуб не найден', 404);

    const rights = await can(club, viewerId, { isSiteStaff: await isStaff(viewerId) });
    if (club.isPrivate && !rights.isMember && !rights.isOwner && !rights.canEdit) {
      return fail('Это закрытый клуб: содержимое видят только участники', 403);
    }

    const members = await ClubMember.findAll({
      where: { clubId: club.id },
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'avatar'] }],
      order: [['role', 'ASC'], ['createdAt', 'ASC']],
      limit: 60
    });

    const schedule = await ClubSchedule.findAll({
      where: { clubId: club.id },
      order: [['chapter', 'ASC']],
      limit: LIMITS.schedule
    });

    const posts = await ClubPost.findAll({
      where: { clubId: club.id, state: 'published' },
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'avatar'] }],
      order: [['createdAt', 'DESC']],
      limit: 60
    });

    // Глава читателя: если не передана, берём последнюю отметку прогресса по книге клуба
    let myChapter = Number(viewerChapter) || null;
    if (!myChapter && viewerId && club.currentBookId) {
      const entry = await LibraryEntry.findOne({
        where: { userId: viewerId, bookId: club.currentBookId },
        attributes: ['currentPage']
      });
      myChapter = entry ? Number(entry.currentPage) || null : null;
    }

    const visiblePosts = posts.map((post) => {
      const plain = post.get({ plain: true });
      const blocked = Boolean(
        plain.hasSpoilers
        && plain.chapter
        && (!myChapter || Number(myChapter) < Number(plain.chapter))
      );
      return {
        ...plain,
        myChapter,
        // Спойлер не отдаём в HTML вообще: сервер отдаёт только заглушку
        body: blocked ? null : plain.body,
        blockedByChapter: blocked ? Number(plain.chapter) : null
      };
    });

    const currentBook = club.currentBookId ? await Book.findByPk(club.currentBookId) : null;
    const owner = await User.findByPk(club.ownerId, { attributes: ['id', 'name'] });

    const pendingRequests = rights.canEdit
      ? await ClubRequest.findAll({
        where: { clubId: club.id, state: 'pending' },
        include: [{ model: User, as: 'user', attributes: ['id', 'name', 'bio'] }],
        order: [['createdAt', 'ASC']],
        limit: 40
      })
      : [];

    return {
      club,
      owner,
      rights,
      members,
      schedule,
      posts: visiblePosts,
      currentBook,
      pendingRequests,
      myChapter
    };
  }

  /** Открытый клуб: вступил сразу. Закрытый: заявка на рассмотрение. */
  async function join({ clubId, userId, message = '' }) {
    const club = await Club.findByPk(clubId);
    if (!club) return fail('Клуб не найден', 404);
    if (club.ownerId === userId) return fail('Вы владелец этого клуба');
    if (await membership(clubId, userId)) return fail('Вы уже в клубе');

    if (club.isPrivate) {
      const existing = await ClubRequest.findOne({ where: { clubId, userId, state: 'pending' } });
      if (existing) return fail('Заявка уже отправлена — ждём решения');
      const request = await ClubRequest.create({
        clubId,
        userId,
        message: String(message || '').slice(0, LIMITS.request.max)
      });
      // Уведомление владельцу о заявке
      if (Notification) {
        const user = await User.findByPk(userId, { attributes: ['name'] });
        await Notification.create({
          userId: club.ownerId,
          type: 'club',
          title: `${user ? user.name : 'Читатель'} просится в клуб «${club.name}»`,
          body: request.message,
          url: `/kluby/${club.slug}`
        });
      }
      return { request, pending: true };
    }

    return addMember({ club, userId, role: 'member' });
  }

  async function addMember({ club, userId, role = 'member' }) {
    await ClubMember.create({ clubId: club.id, userId, role });
    await Club.update(
      { membersCount: sql.literal('"members_count" + 1'), lastActivityAt: new Date() },
      { where: { id: club.id } }
    );
    if (Activity) {
      await Activity.create({ userId, type: 'club_join', clubId: club.id, meta: {} });
    }
    return { joined: true, role };
  }

  /** Выход из клуба: владелец выйти не может, пока не передаст клуб. */
  async function leave({ clubId, userId }) {
    const club = await Club.findByPk(clubId);
    if (!club) return fail('Клуб не найден', 404);
    if (club.ownerId === userId) return fail('Владелец не может выйти: сначала передайте клуб другому');
    const member = await membership(clubId, userId);
    if (!member) return fail('Вы не в этом клубе');

    await member.destroy();
    await Club.update(
      { membersCount: sql.literal('GREATEST("members_count" - 1, 0)') },
      { where: { id: club.id } }
    );
    return { left: true };
  }

  /** Редактирование: только владелец/модератор клуба или модерация сайта. */
  async function update({ clubId, userId, name, description, isPrivate, cover, currentBookId }) {
    const club = await Club.findByPk(clubId);
    if (!club) return fail('Клуб не найден', 404);

    const rights = await can(club, userId, { isSiteStaff: await isStaff(userId) });
    if (!rights.canEdit) return fail('Редактировать клуб может только владелец или модератор клуба', 403);

    const patch = {};
    if (name !== undefined) {
      const clean = String(name).replace(/\s+/g, ' ').trim();
      if (clean.length < LIMITS.name.min) return fail('Название слишком короткое');
      if (clean.length > LIMITS.name.max) return fail('Название слишком длинное');
      patch.name = clean;
    }
    if (description !== undefined) {
      const clean = String(description).trim();
      if (clean.length < LIMITS.description.min) return fail('Описание слишком короткое');
      if (clean.length > LIMITS.description.max) return fail('Описание слишком длинное');
      patch.description = clean;
    }
    if (isPrivate !== undefined) patch.isPrivate = Boolean(isPrivate);
    if (cover) patch.cover = String(cover).slice(0, 255);

    // Книгу месяца меняет владелец или модератор; книга должна существовать
    if (currentBookId !== undefined) {
      if (!rights.canManageRoles && !rights.canEdit) return fail('Недостаточно прав', 403);
      if (currentBookId === null || currentBookId === '') {
        patch.currentBookId = null;
      } else {
        const book = await Book.findByPk(currentBookId);
        if (!book) return fail('Такой книги нет в каталоге');
        patch.currentBookId = book.id;
        patch.lastActivityAt = new Date();
      }
    }

    await club.update(patch);
    return { club };
  }

  /** Роли: назначать может только владелец (или модерация сайта). */
  async function setRole({ clubId, actorId, targetUserId, role }) {
    const club = await Club.findByPk(clubId);
    if (!club) return fail('Клуб не найден', 404);

    const rights = await can(club, actorId, { isSiteStaff: await isStaff(actorId) });
    if (!rights.canManageRoles) return fail('Менять роли может только владелец клуба', 403);
    if (!ROLES.includes(role)) return fail('Неизвестная роль');
    if (Number(targetUserId) === Number(club.ownerId)) return fail('Роль владельца не меняется — передайте клуб отдельно');

    const member = await membership(clubId, Number(targetUserId));
    if (!member) return fail('Этот человек не в клубе', 404);

    await member.update({ role });
    return { member };
  }

  /** Заявки в закрытый клуб: принять или отклонить. */
  async function decideRequest({ requestId, actorId, decision }) {
    const request = await ClubRequest.findByPk(requestId);
    if (!request) return fail('Заявка не найдена', 404);
    if (request.state !== 'pending') return fail('Заявка уже рассмотрена');

    const club = await Club.findByPk(request.clubId);
    const rights = await can(club, actorId, { isSiteStaff: await isStaff(actorId) });
    if (!rights.canEdit) return fail('Рассматривать заявки могут только владелец и модераторы клуба', 403);

    if (decision === 'accept') {
      await request.update({ state: 'accepted' });
      if (!(await membership(club.id, request.userId))) {
        await ClubMember.create({ clubId: club.id, userId: request.userId, role: 'member' });
        await Club.update(
          { membersCount: sql.literal('"members_count" + 1'), lastActivityAt: new Date() },
          { where: { id: club.id } }
        );
        if (Activity) {
          await Activity.create({ userId: request.userId, type: 'club_join', clubId: club.id, meta: {} });
        }
      }
      if (Notification) {
        await Notification.create({
          userId: request.userId,
          type: 'club',
          title: `Вас приняли в клуб «${club.name}»`,
          body: '',
          url: `/kluby/${club.slug}`
        });
      }
      return { accepted: true };
    }

    await request.update({ state: 'rejected' });
    return { rejected: true };
  }

  /** Приглашение: одноразовая ссылка. Владелец может выдать многоразовую. */
  async function createInvite({ clubId, actorId, maxUses = 1, days = 14 }) {
    const club = await Club.findByPk(clubId);
    if (!club) return fail('Клуб не найден', 404);

    const rights = await can(club, actorId, { isSiteStaff: await isStaff(actorId) });
    if (!rights.canEdit) return fail('Приглашения может создавать только владелец или модератор клуба', 403);

    const uses = Math.min(100, Math.max(1, Number(maxUses) || 1));
    const expiresAt = days ? new Date(Date.now() + Math.min(365, Math.max(1, Number(days))) * 86400000) : null;

    const invite = await ClubInvite.create({
      clubId: club.id,
      code: crypto.randomBytes(9).toString('base64url'),
      createdByUserId: actorId,
      maxUses: uses,
      expiresAt
    });

    return { invite };
  }

  /** Вход по ссылке. Одноразовый код срабатывает один раз. */
  async function useInvite({ code, userId }) {
    const invite = await ClubInvite.findOne({ where: { code: String(code || '') } });
    if (!invite) return fail('Приглашение не найдено или уже использовано', 404);
    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) return fail('Срок приглашения истёк', 410);
    if (invite.usesCount >= invite.maxUses) return fail('Приглашение уже использовано', 410);

    const club = await Club.findByPk(invite.clubId);
    if (!club) return fail('Клуб не найден', 404);

    if (await membership(club.id, userId)) return fail('Вы уже в этом клубе');

    await ClubMember.create({ clubId: club.id, userId, role: 'member' });
    await Club.update(
      { membersCount: sql.literal('"members_count" + 1'), lastActivityAt: new Date() },
      { where: { id: club.id } }
    );
    // Атомарный счётчик использований: два одновременных клика не проскочат
    await ClubInvite.update(
      { usesCount: sql.literal('"uses_count" + 1') },
      { where: { id: invite.id } }
    );

    if (Activity) {
      await Activity.create({ userId, type: 'club_join', clubId: club.id, meta: { invite: true } });
    }

    const fresh = await ClubInvite.findByPk(invite.id);
    return { club, invite: fresh };
  }

  /** Расписание по главам: до 40 пунктов, главы уникальны. */
  async function addSchedule({ clubId, actorId, chapter, discussionOn, note = '' }) {
    const club = await Club.findByPk(clubId);
    if (!club) return fail('Клуб не найден', 404);

    const rights = await can(club, actorId, { isSiteStaff: await isStaff(actorId) });
    if (!rights.canEdit) return fail('Расписание ведёт владелец или модератор клуба', 403);

    const number = Number(chapter);
    if (!Number.isInteger(number) || number < LIMITS.chapter.min || number > LIMITS.chapter.max) {
      return fail(`Глава: целое число от ${LIMITS.chapter.min} до ${LIMITS.chapter.max}`);
    }

    const date = String(discussionOn || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) {
      return fail('Дата обсуждения: формат ГГГГ-ММ-ДД');
    }

    const count = await ClubSchedule.count({ where: { clubId } });
    if (count >= LIMITS.schedule) return fail(`В расписании уже ${LIMITS.schedule} глав — больше не влезет`);

    const existing = await ClubSchedule.findOne({ where: { clubId, chapter: number } });
    if (existing) return fail(`Глава ${number} уже есть в расписании`);

    const item = await ClubSchedule.create({
      clubId,
      chapter: number,
      discussionOn: date,
      note: String(note || '').slice(0, 300)
    });
    return { item };
  }

  /**
   * Пост в обсуждении. Спойлер обязан ссылаться на главу — иначе непонятно,
   * до какого места читать. Гостям и не-участникам писать нельзя.
   */
  async function addPost({ clubId, userId, body, chapter = null, hasSpoilers = false }) {
    const club = await Club.findByPk(clubId);
    if (!club) return fail('Клуб не найден', 404);

    const rights = await can(club, userId, { isSiteStaff: await isStaff(userId) });
    if (!rights.canPost) return fail('Писать в обсуждении могут только участники клуба', 403);

    const text = String(body || '').trim();
    if (text.length < LIMITS.post.min) return fail(`Сообщение: минимум ${LIMITS.post.min} символа`);
    if (text.length > LIMITS.post.max) return fail(`Сообщение: максимум ${LIMITS.post.max} символов`);

    const chapterNumber = chapter === null || chapter === '' ? null : Number(chapter);
    if (chapterNumber !== null && (!Number.isInteger(chapterNumber) || chapterNumber < LIMITS.chapter.min)) {
      return fail('Глава: целое число больше нуля');
    }
    if (hasSpoilers && !chapterNumber) {
      return fail('У спойлера укажите главу: иначе читатели на первой странице его увидят');
    }

    const post = await ClubPost.create({
      clubId: club.id,
      userId,
      body: text,
      chapter: chapterNumber,
      hasSpoilers: Boolean(hasSpoilers)
    });

    await Club.update(
      { postsCount: sql.literal('"posts_count" + 1'), lastActivityAt: new Date() },
      { where: { id: club.id } }
    );

    if (Activity) {
      await Activity.create({ userId, type: 'club_post', clubId: club.id, meta: { chapter: chapterNumber } });
    }

    return { post };
  }

  /** Скрыть пост может модератор клуба или модерация сайта. */
  async function hidePost({ postId, actorId }) {
    const post = await ClubPost.findByPk(postId);
    if (!post) return fail('Сообщение не найдено', 404);

    const club = await Club.findByPk(post.clubId);
    const rights = await can(club, actorId, { isSiteStaff: await isStaff(actorId) });
    if (!rights.canModerate) return fail('Скрывать сообщения могут только модераторы клуба', 403);

    await post.update({ state: 'hidden' });
    await Club.update(
      { postsCount: sql.literal('GREATEST("posts_count" - 1, 0)') },
      { where: { id: club.id } }
    );
    return { hidden: true };
  }

  /** Мои клубы — для профиля и навигации. */
  async function myClubs(userId, limit = 12) {
    const rows = await ClubMember.findAll({
      where: { userId },
      include: [{ model: Club, as: 'club' }],
      order: [['createdAt', 'DESC']],
      limit
    });
    return rows.map((row) => ({ ...row.club.get({ plain: true }), myRole: row.role }));
  }

  return {
    create,
    list,
    detail,
    find,
    can,
    join,
    leave,
    update,
    setRole,
    decideRequest,
    createInvite,
    useInvite,
    addSchedule,
    addPost,
    hidePost,
    myClubs,
    membership,
    isStaff,
    LIMITS,
    ROLES,
    ROLE_LABELS
  };
}

module.exports = { createClubService, ROLES, ROLE_LABELS, LIMITS };
