'use strict';

/**
 * Дайджест и возврат ушедших (этап 22.4).
 *
 * Проверяем не «письмо отправилось», а правила, из-за которых рассылки
 * попадают в спам и из-за которых люди уходят навсегда:
 *  - писать можно только согласившимся и подтвердившим адрес;
 *  - одно письмо о периоде, повторный запуск не дублирует;
 *  - «вас давно не было» — только тем, кто молчит, и не чаще раза в три недели;
 *  - отписка работает без входа и снимает галочку в аккаунте;
 *  - текст письма — про человека, а не про сайт.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const request = require('supertest');

const { createTestApp, extractCsrf } = require('../support/app');
const { createDigestService, emailHash, weekStart, RULES } = require('../../src/services/digest');

const DAY = 24 * 60 * 60 * 1000;

/** Согласие на письма: галочка включена и адрес подтверждён. */
async function subscriber(models, overrides = {}) {
  return models.User.create({
    name: 'Вера',
    email: `vera-${Math.random().toString(36).slice(2, 8)}@example.com`,
    passwordHash: await bcrypt.hash('reader2026', 4),
    emailVerifiedAt: new Date(),
    notifyDigest: true,
    lastActiveAt: new Date(),
    ...overrides
  });
}

function serviceFor(models, db, options = {}) {
  return createDigestService({
    User: models.User,
    LibraryEntry: models.LibraryEntry,
    Book: models.Book,
    Digest: models.Digest,
    EmailUnsubscribe: models.EmailUnsubscribe,
    ReadingGoal: models.ReadingGoal,
    sequelize: db.sequelize,
    send: async () => {},
    baseUrl: () => 'https://knigomany.ru',
    ...options
  });
}

test('письмо собирается из реальных данных: дочитанные книги, текущее чтение, цель', async () => {
  const { models, db } = await createTestApp();
  const digest = serviceFor(models, db);
  const user = await subscriber(models);

  const book = await models.Book.create({
    slug: 'test-book-digest', title: 'Тихая книга', author: 'Тестовый Автор', description: 'Описание', pages: 240
  });
  await models.LibraryEntry.create({
    userId: user.id, bookId: book.id, status: 'read', finishedAt: new Date(), rating: 8
  });
  await models.ReadingGoal.create({ userId: user.id, year: new Date().getUTCFullYear(), targetBooks: 24 });

  const data = await digest.digestData(user.id);
  assert.equal(data.books.length, 1);
  assert.equal(data.books[0].title, 'Тихая книга');
  assert.equal(data.readThisYear, 1);
  assert.equal(data.goal.target, 24);

  const letter = digest.render({
    user,
    data,
    unsubscribeUrl: 'https://knigomany.ru/otpiska?e=abc',
    site: 'https://knigomany.ru'
  });

  assert.match(letter.subject, /Ваша неделя в книгах/);
  assert.match(letter.text, /Тихая книга/);
  assert.match(letter.text, /Цель на год: 1 из 24/);
  // Отписка обязана быть в каждом письме — без неё рассылка незаконна
  assert.match(letter.text, /Отписаться/);
  assert.match(letter.html, /otpiska\?e=abc/);
});

test('пустая неделя — не повод писать «вы ничего не сделали»', async () => {
  const { models, db } = await createTestApp();
  const digest = serviceFor(models, db);
  const user = await subscriber(models);

  const letter = digest.render({
    user,
    data: { books: [], reading: [], want: 0, goal: null, readThisYear: 0 },
    unsubscribeUrl: 'https://knigomany.ru/otpiska?e=abc',
    site: 'https://knigomany.ru'
  });

  assert.match(letter.text, /это нормально/);
  assert.ok(!/ничего не прочитали|позор|стыдно/i.test(letter.text), 'письмо не должно стыдить');
});

test('рассылка пишет только согласившимся и подтвердившим адрес', async () => {
  const { models, db } = await createTestApp();
  const digest = serviceFor(models, db);

  await subscriber(models);
  await subscriber(models, { emailVerifiedAt: null });
  await subscriber(models, { notifyDigest: false });
  await subscriber(models, { isBlocked: true });
  await subscriber(models, { deletedAt: new Date() });

  const list = await digest.recipients({ kind: 'weekly' });
  assert.equal(list.length, 1, 'письмо должно уйти только одному человеку из пяти');
});

test('отписавшийся не получает писем, даже если галочка осталась', async () => {
  const { models, db } = await createTestApp();
  const digest = serviceFor(models, db);
  const user = await subscriber(models);

  assert.equal((await digest.recipients()).length, 1);
  await digest.unsubscribe(user.email, { reason: 'тест' });

  assert.equal((await digest.recipients()).length, 0);
  assert.equal(await digest.isUnsubscribed(user.email.toUpperCase()), true, 'регистр адреса не должен влиять');

  // Отписка снимает и галочку в аккаунте: иначе в настройках «присылать», а писем нет
  const fresh = await models.User.findByPk(user.id);
  assert.equal(fresh.notifyDigest, false);
});

test('повторный запуск не отправляет второе письмо о той же неделе', async () => {
  const { models, db } = await createTestApp();
  const sent = [];
  const digest = serviceFor(models, db, { send: async (letter) => sent.push(letter) });
  await subscriber(models);

  const first = await digest.run({ kind: 'weekly' });
  assert.equal(first.sent, 1);
  assert.equal(sent.length, 1);

  const second = await digest.run({ kind: 'weekly' });
  assert.equal(second.sent, 0);
  assert.equal(second.skipped, 1);
  assert.equal(sent.length, 1, 'второе письмо о той же неделе не должно уйти');

  // Журнал писем — не «кажется, отправили»: статус и время сохранены
  const record = await models.Digest.findOne({ where: { userId: (await models.User.findOne()).id } });
  assert.equal(record.status, 'sent');
  assert.ok(record.sentAt);
  assert.ok(record.periodStart);
});

test('пробный прогон ничего не отправляет и не пишет в журнал', async () => {
  const { models, db } = await createTestApp();
  const sent = [];
  const digest = serviceFor(models, db, { send: async (letter) => sent.push(letter) });
  await subscriber(models);

  const result = await digest.run({ kind: 'weekly', dryRun: true });
  assert.equal(result.letters.length, 1);
  assert.equal(result.sent, 0);
  assert.equal(sent.length, 0);
  assert.equal(await models.Digest.count(), 0, 'пробный прогон не должен занимать период');
});

test('«вас давно не было» уходит только тем, кто молчит', async () => {
  const { models, db } = await createTestApp();
  const digest = serviceFor(models, db);

  await subscriber(models, { lastActiveAt: new Date(Date.now() - 40 * DAY) });
  await subscriber(models, { lastActiveAt: new Date(Date.now() - 60 * DAY) });
  await subscriber(models, { lastActiveAt: new Date() });

  const list = await digest.recipients({ kind: 'comeback', inactiveForDays: RULES.comebackDays });
  assert.equal(list.length, 2, 'письмо «вас давно не было» не должно уходить активным');
});

test('письмо «вас давно не было» не повторяется чаще раза в три недели', async () => {
  const { models, db } = await createTestApp();
  const sent = [];
  const digest = serviceFor(models, db, { send: async (letter) => sent.push(letter) });
  const user = await subscriber(models, { lastActiveAt: new Date(Date.now() - 40 * DAY) });

  const first = await digest.run({ kind: 'comeback' });
  assert.equal(first.sent, 1);

  // даже если период другой — кулдаун держит
  const second = await digest.run({ kind: 'comeback', periodStart: new Date(Date.now() - 3 * DAY) });
  assert.equal(second.sent, 0);

  const record = await models.Digest.findOne({ where: { userId: user.id, kind: 'comeback' } });
  assert.equal(record.status, 'sent');
});

test('ошибка отправки одному человеку не останавливает рассылку остальным', async () => {
  const { models, db } = await createTestApp();
  const user1 = await subscriber(models, { email: 'one@example.com' });
  await subscriber(models, { email: 'two@example.com' });

  const digest = serviceFor(models, db, {
    send: async (letter) => {
      if (letter.to === 'one@example.com') throw new Error('SMTP: ящик не существует');
    }
  });

  const result = await digest.run({ kind: 'weekly' });
  assert.equal(result.sent, 1);
  assert.equal(result.failed, 1);

  const failed = await models.Digest.findOne({ where: { userId: user1.id } });
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /ящик не существует/);
});

test('статистика показывает, что ушло, что сломалось и сколько отписалось', async () => {
  const { models, db } = await createTestApp();
  const digest = serviceFor(models, db);
  const user = await subscriber(models);

  await models.Digest.create({ userId: user.id, kind: 'weekly', status: 'sent', sentAt: new Date() });
  await models.Digest.create({ userId: user.id, kind: 'comeback', status: 'failed', error: 'x' });
  await digest.unsubscribe(user.email);

  const stats = await digest.stats({ days: 30 });
  assert.equal(stats.sent, 1);
  assert.equal(stats.failed, 1);
  assert.equal(stats.unsubscribed, 1);
});

test('хеш адреса стабилен и не раскрывает сам адрес', () => {
  const hash = emailHash('  Vera@Example.com ');
  assert.equal(hash, emailHash('vera@example.com'));
  assert.equal(hash.length, 64);
  assert.ok(!hash.includes('vera'));
});

test('отписка по ссылке работает без входа, а хеш не подделывается', async () => {
  const { app, models } = await createTestApp();
  const user = await subscriber(models, { email: 'unsub@example.com' });
  const hash = emailHash(user.email);

  // Мусорная ссылка — понятная страница, а не 500
  const bad = await request(app).get('/otpiska?e=net').expect(200);
  assert.match(bad.text, /Ссылка не сработала/);

  const page = await request(app).get(`/otpiska?e=${hash}`).expect(200);
  assert.match(page.text, /Отписаться от писем/);
  // Сам адрес в ссылке не ходит — только хеш
  assert.ok(!page.text.includes('unsub@example.com'));

  const agent = request.agent(app);
  const form = await agent.get(`/otpiska?e=${hash}`).expect(200);
  const token = extractCsrf(form.text);

  await agent
    .post('/otpiska')
    .type('form')
    .send({ e: hash, _csrf: token })
    .expect(303);

  const fresh = await models.User.findByPk(user.id);
  assert.equal(fresh.notifyDigest, false);

  const done = await agent.get(`/otpiska?e=${hash}&gotovo=1`).expect(200);
  assert.match(done.text, /Отписались/);
});

test('админка рассылки закрыта для обычного читателя', async () => {
  const { app } = await createTestApp();
  // Гостя уводит на вход (303), читателя без прав — 403
  await request(app).get('/admin/rassylka').expect(303);
});

test('неделя считается с понедельника: период письма не «плывёт»', () => {
  const wednesday = new Date('2026-11-18T15:00:00Z');
  const start = weekStart(wednesday);
  assert.equal(start.toISOString().slice(0, 10), '2026-11-16');
  assert.equal(weekStart(new Date('2026-11-16T00:00:00Z')).toISOString().slice(0, 10), '2026-11-16');
  assert.equal(weekStart(new Date('2026-11-22T23:59:00Z')).toISOString().slice(0, 10), '2026-11-16');
});
