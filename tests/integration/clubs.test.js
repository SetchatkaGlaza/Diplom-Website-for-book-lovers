'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createTestApp, extractCsrf } = require('../support/app');

/**
 * Клубы: права, приватность, спойлеры по главам, приглашения.
 *
 * Главное, что проверяем — попытки обойти права:
 *  - чужой клуб не редактируется и не модерируется;
 *  - в закрытый клуб не попасть без заявки или приглашения;
 *  - спойлер к главе 10 не отдаётся читателю на главе 3 (и просто не попадает в HTML);
 *  - приглашение одноразовое.
 */

async function signIn(ctx, email, name) {
  const user = await ctx.createUser({ email, name });
  const agent = request.agent(ctx.app);
  await ctx.login(user, 'reader2026', agent);
  return { user, agent };
}

async function csrf(agent, path) {
  const page = await agent.get(path);
  return extractCsrf(page.text);
}

async function makeClub(ctx, ownerId, data = {}) {
  return ctx.services.clubService.create({
    ownerId,
    name: data.name || 'Клуб «Дюна»',
    description: data.description || 'Читаем «Дюну» по главам и обсуждаем без спойлеров.',
    isPrivate: Boolean(data.isPrivate)
  });
}

test('создание клуба: автор становится владельцем, слаг из русского названия', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const { user, agent } = await signIn(ctx, 'anna@example.com', 'Анна');
  const token = await csrf(agent, '/kluby/novyy');

  const created = await agent.post('/kluby').type('form').send({
    _csrf: token,
    name: 'Читаем «Дюну» по главам',
    description: 'Идём медленно, по три главы в неделю, спойлеры прячем.'
  });

  assert.equal(created.status, 303);
  assert.match(created.headers.location, /^\/kluby\/[a-z0-9-]+$/);

  const club = await ctx.models.Club.findOne();
  assert.equal(club.ownerId, user.id);
  assert.equal(club.slug, 'chitaem-dyunu-po-glavam');

  const member = await ctx.models.ClubMember.findOne({ where: { clubId: club.id, userId: user.id } });
  assert.equal(member.role, 'owner', 'владелец сразу участник с ролью owner');

  const page = await agent.get(`/kluby/${club.slug}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /Вы владелец/);
});

test('создание: слишком короткое описание отклоняется с ошибкой формы', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const { agent } = await signIn(ctx, 'anna@example.com', 'Анна');
  const token = await csrf(agent, '/kluby/novyy');

  const response = await agent.post('/kluby').type('form')
    .send({ _csrf: token, name: 'Да', description: 'Мало' });

  assert.equal(response.status, 422);
  assert.match(response.text, /Название/);
  assert.equal(await ctx.models.Club.count(), 0);
});

test('чужой клуб нельзя редактировать и модерировать', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signIn(ctx, 'anna@example.com', 'Анна');
  const boris = await signIn(ctx, 'boris@example.com', 'Борис');

  const { club } = await makeClub(ctx, anna.user.id);

  // Борис — посторонний
  const token = await csrf(boris.agent, `/kluby/${club.slug}`);
  const edit = await boris.agent.post(`/kluby/${club.slug}/redaktirovat`).type('form')
    .send({ _csrf: token, name: 'Мой клуб теперь', description: 'Полностью переписанное описание клуба' });
  assert.equal(edit.status, 403, 'редактирование чужого клуба — 403');

  const role = await boris.agent.post(`/kluby/${club.slug}/rol`).type('form')
    .send({ _csrf: token, userId: boris.user.id, role: 'moderator' });
  assert.equal(role.status, 403, 'выдать себе роль — 403');

  const invite = await boris.agent.post(`/kluby/${club.slug}/priglashenie`).type('form')
    .send({ _csrf: token, maxUses: 5 });
  assert.equal(invite.status, 403, 'приглашения создаёт только владелец');

  const fresh = await ctx.models.Club.findByPk(club.id);
  assert.equal(fresh.name, 'Клуб «Дюна»', 'название не изменилось');
  assert.equal(await ctx.models.ClubInvite.count(), 0);
});

test('владелец назначает модератора, модератор ведёт расписание, но роли не меняет', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signIn(ctx, 'anna@example.com', 'Анна');
  const boris = await signIn(ctx, 'boris@example.com', 'Борис');

  const { club } = await makeClub(ctx, anna.user.id);
  await ctx.services.clubService.join({ clubId: club.id, userId: boris.user.id });

  // Владелец делает Бориса модератором
  const ownerToken = await csrf(anna.agent, `/kluby/${club.slug}`);
  const promoted = await anna.agent.post(`/kluby/${club.slug}/rol`).type('form')
    .send({ _csrf: ownerToken, userId: String(boris.user.id), role: 'moderator' });
  assert.equal(promoted.status, 303);
  assert.equal((await ctx.models.ClubMember.findOne({ where: { userId: boris.user.id } })).role, 'moderator');

  // Модератор может добавить главу
  const modToken = await csrf(boris.agent, `/kluby/${club.slug}`);
  const schedule = await boris.agent.post(`/kluby/${club.slug}/raspisanie`).type('form')
    .send({ _csrf: modToken, chapter: '5', discussionOn: '2026-12-05', note: 'До середины' });
  assert.equal(schedule.status, 303);
  assert.equal(await ctx.models.ClubSchedule.count(), 1);

  // Но не может назначить другого модератора
  const escalate = await boris.agent.post(`/kluby/${club.slug}/rol`).type('form')
    .send({ _csrf: modToken, userId: String(anna.user.id), role: 'moderator' });
  assert.equal(escalate.status, 403, 'модератор не меняет роли');
});

test('закрытый клуб: посторонний не видит содержимое, заявка работает', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signIn(ctx, 'anna@example.com', 'Анна');
  const boris = await signIn(ctx, 'boris@example.com', 'Борис');

  const { club } = await makeClub(ctx, anna.user.id, { isPrivate: true });
  await ctx.services.clubService.addPost({
    clubId: club.id, userId: anna.user.id, body: 'Секретное обсуждение только для своих'
  });

  // Посторонний получает 403 и не видит текст
  const closed = await boris.agent.get(`/kluby/${club.slug}`);
  assert.equal(closed.status, 403);
  assert.ok(!closed.text.includes('Секретное обсуждение'));

  // Закрытый клуб не показывается в списке
  const list = await boris.agent.get('/kluby');
  assert.ok(!list.text.includes('Клуб «Дюна»'), 'закрытый клуб не виден посторонним в списке');

  // Заявка
  const token = await csrf(boris.agent, '/kluby');
  const applied = await boris.agent.post(`/kluby/${club.slug}/vstupit`).type('form')
    .send({ _csrf: token, message: 'Хочу читать вместе' });
  assert.equal(applied.status, 303);

  const request = await ctx.models.ClubRequest.findOne({ where: { clubId: club.id, userId: boris.user.id } });
  assert.ok(request, 'заявка создана');
  assert.equal(request.message, 'Хочу читать вместе');

  // Уведомление владельцу
  const notes = await ctx.models.Notification.findAll({ where: { userId: anna.user.id } });
  assert.ok(notes.some((note) => /просится в клуб/.test(note.title)));

  // Владелец принимает заявку
  const ownerToken = await csrf(anna.agent, `/kluby/${club.slug}`);
  const decided = await anna.agent.post(`/kluby/${club.slug}/zayavka/${request.id}`).type('form')
    .send({ _csrf: ownerToken, decision: 'accept' });
  assert.equal(decided.status, 303);
  assert.equal((await ctx.models.ClubMember.findOne({ where: { clubId: club.id, userId: boris.user.id } })).role, 'member');

  // Теперь видит
  const opened = await boris.agent.get(`/kluby/${club.slug}`);
  assert.equal(opened.status, 200);
  assert.match(opened.text, /Секретное обсуждение/);
});

test('заявку в чужом клубе рассмотреть нельзя', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signIn(ctx, 'anna@example.com', 'Анна');
  const boris = await signIn(ctx, 'boris@example.com', 'Борис');
  const vera = await signIn(ctx, 'vera@example.com', 'Вера');

  const { club } = await makeClub(ctx, anna.user.id, { isPrivate: true });
  const join = await ctx.services.clubService.join({ clubId: club.id, userId: boris.user.id, message: 'Пустите' });
  assert.ok(join.pending);

  const token = await csrf(vera.agent, '/kluby');
  const response = await vera.agent.post(`/kluby/${club.slug}/zayavka/${join.request.id}`).type('form')
    .send({ _csrf: token, decision: 'accept' });
  assert.equal(response.status, 403, 'чужую заявку рассматривать нельзя');
  assert.equal(await ctx.models.ClubMember.count({ where: { clubId: club.id } }), 1, 'только владелец');
});

test('спойлер главы 10 не виден тому, кто на главе 3', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signIn(ctx, 'anna@example.com', 'Анна');
  const boris = await signIn(ctx, 'boris@example.com', 'Борис');

  const { club } = await makeClub(ctx, anna.user.id);
  await ctx.services.clubService.join({ clubId: club.id, userId: boris.user.id });

  await ctx.services.clubService.addPost({
    clubId: club.id, userId: anna.user.id, body: 'До главы десяти всё спокойно', chapter: 3
  });
  await ctx.services.clubService.addPost({
    clubId: club.id, userId: anna.user.id, body: 'В главе десятой погибает герцог', chapter: 10, hasSpoilers: true
  });

  // Читатель на главе 3: спойлера нет в HTML вообще
  const early = await boris.agent.get(`/kluby/${club.slug}?glava=3`);
  assert.equal(early.status, 200);
  assert.ok(!early.text.includes('погибает герцог'), 'сервер не отдаёт текст спойлера');
  assert.match(early.text, /Спойлер к главе 10/);
  assert.match(early.text, /До главы десяти всё спокойно/);

  // Дочитал до главы 10 — видит
  const late = await boris.agent.get(`/kluby/${club.slug}?glava=10`);
  assert.match(late.text, /погибает герцог/);

  // Без указания главы спойлер тоже скрыт
  const noChapter = await boris.agent.get(`/kluby/${club.slug}`);
  assert.ok(!noChapter.text.includes('погибает герцог'));
});

test('спойлер без главы не принимается', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signIn(ctx, 'anna@example.com', 'Анна');
  const { club } = await makeClub(ctx, anna.user.id);

  const result = await ctx.services.clubService.addPost({
    clubId: club.id, userId: anna.user.id, body: 'Спойлер без номера главы', hasSpoilers: true
  });
  assert.equal(result.error, 'У спойлера укажите главу: иначе читатели на первой странице его увидят');
  assert.equal(await ctx.models.ClubPost.count(), 0);
});

test('приглашение одноразовое и не срабатывает второй раз', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signIn(ctx, 'anna@example.com', 'Анна');
  const boris = await signIn(ctx, 'boris@example.com', 'Борис');
  const vera = await signIn(ctx, 'vera@example.com', 'Вера');

  const { club } = await makeClub(ctx, anna.user.id, { isPrivate: true });

  const ownerToken = await csrf(anna.agent, `/kluby/${club.slug}`);
  const created = await anna.agent.post(`/kluby/${club.slug}/priglashenie`).type('form')
    .send({ _csrf: ownerToken, maxUses: '1', days: '7' });
  assert.equal(created.status, 303);

  const invite = await ctx.models.ClubInvite.findOne();
  assert.equal(invite.maxUses, 1);
  assert.equal(invite.usesCount, 0);

  // Борис заходит по ссылке
  const borisToken = await csrf(boris.agent, `/priglashenie/${invite.code}`);
  const first = await boris.agent.post(`/priglashenie/${invite.code}`).type('form').send({ _csrf: borisToken });
  assert.equal(first.status, 303);
  assert.equal(first.headers.location, `/kluby/${club.slug}`);

  // Вера по той же ссылке — уже нельзя
  const veraToken = await csrf(vera.agent, `/priglashenie/${invite.code}`);
  const second = await vera.agent.post(`/priglashenie/${invite.code}`).type('form').send({ _csrf: veraToken });
  assert.equal(second.headers.location, `/priglashenie/${invite.code}`, 'второй раз — обратно на страницу с ошибкой');

  const page = await vera.agent.get(`/priglashenie/${invite.code}`);
  assert.match(page.text, /уже использована/i);

  assert.equal(await ctx.models.ClubMember.count({ where: { clubId: club.id } }), 2, 'владелец и Борис');
});

test('истёкшее приглашение не работает', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signIn(ctx, 'anna@example.com', 'Анна');
  const boris = await signIn(ctx, 'boris@example.com', 'Борис');

  const { club } = await makeClub(ctx, anna.user.id, { isPrivate: true });
  const result = await ctx.services.clubService.createInvite({ clubId: club.id, actorId: anna.user.id, days: 1 });

  await ctx.models.ClubInvite.update(
    { expiresAt: new Date(Date.now() - 86400000) },
    { where: { id: result.invite.id } }
  );

  const use = await ctx.services.clubService.useInvite({ code: result.invite.code, userId: boris.user.id });
  assert.equal(use.error, 'Срок приглашения истёк');

  const page = await boris.agent.get(`/priglashenie/${result.invite.code}`);
  assert.match(page.text, /Срок приглашения истёк/);
  assert.equal(await ctx.models.ClubMember.count({ where: { clubId: club.id } }), 1);
});

test('владелец не может выйти из клуба, участник может', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signIn(ctx, 'anna@example.com', 'Анна');
  const boris = await signIn(ctx, 'boris@example.com', 'Борис');

  const { club } = await makeClub(ctx, anna.user.id);
  await ctx.services.clubService.join({ clubId: club.id, userId: boris.user.id });

  const ownerAttempt = await ctx.services.clubService.leave({ clubId: club.id, userId: anna.user.id });
  assert.match(ownerAttempt.error, /Владелец не может выйти/);

  const left = await ctx.services.clubService.leave({ clubId: club.id, userId: boris.user.id });
  assert.ok(left.left);

  const fresh = await ctx.models.Club.findByPk(club.id);
  assert.equal(fresh.membersCount, 1, 'счётчик участников уменьшился');
});

test('гость видит клубы, но не может вступить', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signIn(ctx, 'anna@example.com', 'Анна');
  const { club } = await makeClub(ctx, anna.user.id);

  const guest = request.agent(ctx.app);
  const list = await guest.get('/kluby');
  assert.equal(list.status, 200);
  assert.match(list.text, /Клуб «Дюна»/);

  const page = await guest.get(`/kluby/${club.slug}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /Войти, чтобы вступить/);

  const attempt = await guest.post(`/kluby/${club.slug}/vstupit`);
  assert.equal(attempt.status, 403, 'без CSRF-токена и входа — отказ');
});

test('расписание: дубли глав и кривые даты отклоняются', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signIn(ctx, 'anna@example.com', 'Анна');
  const { club } = await makeClub(ctx, anna.user.id);

  const first = await ctx.services.clubService.addSchedule({
    clubId: club.id, actorId: anna.user.id, chapter: 1, discussionOn: '2026-12-01'
  });
  assert.ok(first.item);

  const duplicate = await ctx.services.clubService.addSchedule({
    clubId: club.id, actorId: anna.user.id, chapter: 1, discussionOn: '2026-12-02'
  });
  assert.match(duplicate.error, /уже есть в расписании/);

  const badDate = await ctx.services.clubService.addSchedule({
    clubId: club.id, actorId: anna.user.id, chapter: 2, discussionOn: '01.12.2026'
  });
  assert.match(badDate.error, /формат ГГГГ-ММ-ДД/);

  const zeroChapter = await ctx.services.clubService.addSchedule({
    clubId: club.id, actorId: anna.user.id, chapter: 0, discussionOn: '2026-12-03'
  });
  assert.ok(zeroChapter.error);
  assert.equal(await ctx.models.ClubSchedule.count(), 1);
});
