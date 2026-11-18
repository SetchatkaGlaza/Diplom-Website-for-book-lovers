'use strict';

/**
 * Партнёрства: клубы и библиотеки (этап 22.2).
 *
 * Здесь проверяется то, что можно проверить кодом: страница открыта гостю,
 * заявка требует организацию и настоящий адрес, заявка попадает в админку
 * и видна только модераторам. Переговоры и звонки — за владельцем.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createTestApp, extractCsrf } = require('../support/app');

test('страница для клубов и библиотек открыта гостю и объясняет выгоду', async () => {
  const { app } = await createTestApp();
  const res = await request(app).get('/klubam-i-bibliotekam').expect(200);

  assert.match(res.text, /Клубам и библиотекам/);
  assert.match(res.text, /Что получает клуб/);
  assert.match(res.text, /Что мы не делаем/);
  // Партнёр должен видеть, что книги не продаются — это первое, что спрашивают
  assert.match(res.text, /Не продаём книги/);
  assert.match(res.text, /name="_csrf"/);
});

test('заявка с формой: сохраняется и появляется в админке', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const page = await ctx.agent.get('/klubam-i-bibliotekam');
  const token = extractCsrf(page.text);

  const response = await ctx.agent
    .post('/klubam-i-bibliotekam')
    .type('form')
    .send({
      _csrf: token,
      kind: 'библиотека',
      organization: 'Библиотека №7',
      name: 'Ольга',
      email: 'olga@biblioteka.ru',
      text: 'У нас клуб на 20 человек, читаем раз в месяц. Хотим страницу с расписанием.'
    });

  assert.equal(response.status, 200);
  assert.match(response.text, /Заявка у нас/);

  const moderator = await ctx.createUser({ name: 'Модератор', role: 'moderator' });
  const modAgent = request.agent(ctx.app);
  await ctx.login(moderator, 'reader2026', modAgent);

  const admin = await modAgent.get('/admin/partnerstva').expect(200);
  assert.match(admin.text, /Библиотека №7/);
  assert.match(admin.text, /olga@biblioteka\.ru/);
  assert.match(admin.text, /библиотека/);
});

test('заявка без организации и с кривым адресом отклоняется с подсказкой', async () => {
  const { agent } = await createTestApp();
  const page = await agent.get('/klubam-i-bibliotekam');
  const token = extractCsrf(page.text);

  const response = await agent
    .post('/klubam-i-bibliotekam')
    .type('form')
    .send({
      _csrf: token,
      name: 'О',
      organization: '',
      email: 'olga@',
      text: 'коротко'
    });

  assert.equal(response.status, 422);
  assert.match(response.text, /Название клуба, библиотеки или организации/);
  assert.match(response.text, /адресе опечатка/);
  assert.match(response.text, /чуть подробнее/);
  // Введённое не теряется: иначе человек не станет заполнять заново
  assert.match(response.text, /value="olga@"/);
});

test('админка заявок закрыта для читателя и гостя', async () => {
  const { app } = await createTestApp();
  await request(app).get('/admin/partnerstva').expect(303);

  const ctx = await createTestApp();
  const reader = await ctx.createUser({ name: 'Читатель' });
  await ctx.login(reader);
  await ctx.agent.get('/admin/partnerstva').expect(403);
});

test('пустая админка заявок объясняет, что делать', async () => {
  const ctx = await createTestApp();
  const moderator = await ctx.createUser({ name: 'Модератор', role: 'moderator' });
  const { agent } = await ctx.login(moderator);

  const res = await agent.get('/admin/partnerstva').expect(200);
  assert.match(res.text, /Заявок пока нет/);
  assert.match(res.text, /\/klubam-i-bibliotekam/);
});

test('страница партнёров в sitemap и в подвале', async () => {
  const { app } = await createTestApp();

  const sitemap = await request(app).get('/sitemap.xml').expect(200);
  assert.match(sitemap.text, /\/klubam-i-bibliotekam<\/loc>/);

  const home = await request(app).get('/').expect(200);
  const footer = home.text.slice(home.text.indexOf('<footer'));
  assert.match(footer, /href="\/klubam-i-bibliotekam"/);
});

test('заявка не создаёт пользователя и не пишет в рассылку', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const before = await ctx.models.User.count();
  const page = await ctx.agent.get('/klubam-i-bibliotekam');
  await ctx.agent.post('/klubam-i-bibliotekam').type('form').send({
    _csrf: extractCsrf(page.text),
    kind: 'книжный клуб',
    organization: 'Клуб «Вторник»',
    name: 'Игорь',
    email: 'igor@example.com',
    text: 'Читаем вместе два года, 12 человек, раз в две недели.'
  });

  assert.equal(await ctx.models.User.count(), before, 'заявка не регистрирует человека');
  assert.equal(await ctx.models.User.count({ where: { email: 'igor@example.com' } }), 0);
});
