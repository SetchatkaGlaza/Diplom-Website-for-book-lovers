'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createTestApp, extractCsrf } = require('../support/app');

/**
 * Социальная часть: подписки, приватность, лента, уведомления, сообщения, цитаты.
 *
 * Главные проверки:
 *  - лента из 50 записей грузится небольшим числом запросов (проверяем счётчик SQL);
 *  - чужой диалог прочитать нельзя;
 *  - приватный профиль закрыт для посторонних, но открыт подписчикам;
 *  - выключенные уведомления не приходят.
 */

/** Отдельный агент = отдельный браузер со своей сессией. */
async function signInAs(ctx, email, name) {
  const user = await ctx.createUser({ email, name: name || email.split('@')[0] });
  const guest = request.agent(ctx.app);
  const page = await guest.get('/vhod');
  const response = await guest.post('/vhod').type('form')
    .send({ _csrf: extractCsrf(page.text), email, password: 'reader2026' });
  assert.equal(response.status, 303, `вход ${email} не удался`);
  const home = await guest.get('/');
  return { user, agent: guest, token: extractCsrf(home.text) };
}

async function makeBook(ctx, data = {}) {
  return ctx.models.Book.create({
    slug: data.slug || `kniga-${Math.random().toString(36).slice(2, 10)}`,
    title: data.title || 'Тестовая книга',
    author: data.author || 'Автор',
    pages: 200,
    isPublished: true
  });
}

test('подписка: ставится, отписывается, на себя подписаться нельзя', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signInAs(ctx, 'anna@example.com', 'Анна');
  const boris = await signInAs(ctx, 'boris@example.com', 'Борис');

  const page = await anna.agent.get(`/chitateli/${boris.user.id}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /Подписаться/);

  const followed = await anna.agent.post(`/chitateli/${boris.user.id}/podpiska`).type('form')
    .send({ _csrf: anna.token });
  assert.equal(followed.status, 303);
  assert.equal(await ctx.models.Follow.count(), 1);

  // Повторное нажатие — отписка
  await anna.agent.post(`/chitateli/${boris.user.id}/podpiska`).type('form')
    .send({ _csrf: anna.token });
  assert.equal(await ctx.models.Follow.count(), 0);

  // На себя нельзя
  const selfPage = await anna.agent.get(`/chitateli/${anna.user.id}`);
  const selfToken = extractCsrf(selfPage.text);
  const selfFollow = await anna.agent.post(`/chitateli/${anna.user.id}/podpiska`).type('form')
    .send({ _csrf: selfToken });
  assert.equal(selfFollow.status, 303);
  assert.equal(await ctx.models.Follow.count(), 0, 'подписка на себя не создалась');

  // Уведомление о подписке пришло Борису
  const notes = await ctx.models.Notification.findAll({ where: { userId: boris.user.id } });
  assert.ok(notes.some((note) => /подписался/.test(note.title)));
});

test('приватный профиль: посторонний видит заголовок, но не полку', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signInAs(ctx, 'anna@example.com', 'Анна');
  const boris = await signInAs(ctx, 'boris@example.com', 'Борис');

  const book = await makeBook(ctx, { title: 'Секретная книга' });
  await ctx.models.LibraryEntry.create({ userId: boris.user.id, bookId: book.id, status: 'read' });
  await ctx.models.User.update({ isPrivate: true, bio: 'Читаю ночью' }, { where: { id: boris.user.id } });

  const closed = await anna.agent.get(`/chitateli/${boris.user.id}`);
  assert.equal(closed.status, 200);
  assert.match(closed.text, /Борис/);
  assert.match(closed.text, /Профиль закрыт/);
  assert.ok(!closed.text.includes('Секретная книга'), 'полка закрытого профиля не должна показываться');

  // Подписался — видит полку
  await anna.agent.post(`/chitateli/${boris.user.id}/podpiska`).type('form').send({ _csrf: anna.token });
  const opened = await anna.agent.get(`/chitateli/${boris.user.id}`);
  assert.match(opened.text, /Секретная книга/);
  assert.ok(!/Профиль закрыт/.test(opened.text));

  // Сам хозяин видит свою полку всегда
  const own = await boris.agent.get(`/chitateli/${boris.user.id}`);
  assert.match(own.text, /Секретная книга/);
});

test('лента: события подписок, без дублей, одним запросом на 50 записей', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signInAs(ctx, 'anna@example.com', 'Анна');
  const boris = await signInAs(ctx, 'boris@example.com', 'Борис');

  const books = [];
  for (let i = 1; i <= 50; i += 1) {
    books.push(await makeBook(ctx, { title: `Книга ${i}`, slug: `kniga-${i}` }));
  }

  // Борис ставит 50 книг на полку
  for (const book of books) {
    await ctx.services.socialService.record({ userId: boris.user.id, type: 'shelf', bookId: book.id });
  }
  // И одну книгу дважды за минуту — вторая запись не должна появиться
  await ctx.services.socialService.record({ userId: boris.user.id, type: 'shelf', bookId: books[0].id });

  assert.equal(
    await ctx.models.Activity.count({ where: { userId: boris.user.id } }),
    50,
    'дубль события за 5 минут не записался'
  );

  // Анна подписалась на Бориса и открыла ленту
  await anna.agent.post(`/chitateli/${boris.user.id}/podpiska`).type('form').send({ _csrf: anna.token });

  // Считаем SQL-запросы: лента не должна делать запрос на каждую строку
  let queries = 0;
  const sequelize = ctx.db.sequelize;
  const originalQuery = sequelize.query.bind(sequelize);
  sequelize.query = (...args) => {
    queries += 1;
    return originalQuery(...args);
  };

  let feedResponse;
  try {
    queries = 0;
    feedResponse = await anna.agent.get('/lenta');
  } finally {
    sequelize.query = originalQuery;
  }

  assert.equal(feedResponse.status, 200);
  assert.equal(queries < 15, true, `лента сделала ${queries} запросов — похоже на N+1`);
  assert.match(feedResponse.text, /Книга 50/);
  assert.match(feedResponse.text, /Борис/);

  // Вторая страница тоже работает
  const second = await anna.agent.get('/lenta').query({ stranitsa: 2 });
  assert.equal(second.status, 200);
  assert.match(second.text, /Страница 2 из/);
});

test('лента: чужие записи без подписки не видны, свои — видны', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signInAs(ctx, 'anna@example.com', 'Анна');
  const boris = await signInAs(ctx, 'boris@example.com', 'Борис');

  const book = await makeBook(ctx, { title: 'Книга Бориса' });
  await ctx.services.socialService.record({ userId: boris.user.id, type: 'shelf', bookId: book.id });

  const own = await makeBook(ctx, { title: 'Книга Анны' });
  await ctx.services.socialService.record({ userId: anna.user.id, type: 'finished', bookId: own.id });

  const feed = await anna.agent.get('/lenta');
  assert.match(feed.text, /Книга Анны/);
  assert.ok(!feed.text.includes('Книга Бориса'), 'чужая запись без подписки не должна быть видна');
});

test('уведомления: приходят, отмечаются прочитанными, отключаются настройкой', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signInAs(ctx, 'anna@example.com', 'Анна');
  const boris = await signInAs(ctx, 'boris@example.com', 'Борис');

  // Борис подписывается — у Анны появляется уведомление
  await boris.agent.post(`/chitateli/${anna.user.id}/podpiska`).type('form').send({ _csrf: boris.token });
  const notes = await anna.agent.get('/uvedomleniya');
  assert.match(notes.text, /подписался|Новый подписчик/);

  // Счётчик в шапке показывает 1
  const home = await anna.agent.get('/');
  assert.match(home.text, /badge">1</);

  // «Прочитать все» обнуляет
  const readAll = await anna.agent.post('/uvedomleniya/prochitat').type('form').send({ _csrf: anna.token });
  assert.equal(readAll.status, 303);
  assert.equal(await ctx.models.Notification.count({ where: { userId: anna.user.id, isRead: false } }), 0);

  // Анна выключает уведомления о подписчиках — новое не приходит
  await anna.agent.post('/nastroyki/privatnost').type('form')
    .send({ _csrf: anna.token, notifyComments: '1' });
  const person = await ctx.models.User.findByPk(anna.user.id);
  assert.equal(person.notifyFollows, false);

  await boris.agent.post(`/chitateli/${anna.user.id}/podpiska`).type('form').send({ _csrf: boris.token }); // отписка
  await boris.agent.post(`/chitateli/${anna.user.id}/podpiska`).type('form').send({ _csrf: boris.token }); // снова подписка
  assert.equal(
    await ctx.models.Notification.count({ where: { userId: anna.user.id, type: 'follow' } }),
    1,
    'выключенное уведомление не должно создаваться'
  );
});

test('уведомление о лайке и комментарии к своей рецензии', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signInAs(ctx, 'anna@example.com', 'Анна');
  const boris = await signInAs(ctx, 'boris@example.com', 'Борис');

  const book = await makeBook(ctx, { slug: 'duna', title: 'Дюна' });
  const review = await ctx.models.Review.create({
    userId: anna.user.id, bookId: book.id, rating: 9, body: 'Очень длинная рецензия для теста уведомлений.'
  });

  const page = await boris.agent.get('/knigi/duna');
  const token = extractCsrf(page.text);

  await boris.agent.post(`/retsenziya/${review.id}/like`).type('form').set('Accept', 'application/json')
    .send({ _csrf: token });
  await boris.agent.post(`/retsenziya/${review.id}/komment`).type('form')
    .send({ _csrf: token, body: 'Согласен с вами' });

  const types = (await ctx.models.Notification.findAll({ where: { userId: anna.user.id } }))
    .map((note) => note.type);
  assert.ok(types.includes('like'), 'уведомление о лайке не пришло');
  assert.ok(types.includes('comment'), 'уведомление о комментарии не пришло');

  // Себе лайк — уведомления нет
  const before = await ctx.models.Notification.count({ where: { userId: anna.user.id } });
  const own = await anna.agent.get('/knigi/duna');
  await anna.agent.post(`/retsenziya/${review.id}/like`).type('form').set('Accept', 'application/json')
    .send({ _csrf: extractCsrf(own.text) });
  assert.equal(
    await ctx.models.Notification.count({ where: { userId: anna.user.id } }),
    before,
    'о своём действии уведомление не создаётся'
  );
});

test('сообщения: доходят, диалог один, непрочитанные считаются', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signInAs(ctx, 'anna@example.com', 'Анна');
  const boris = await signInAs(ctx, 'boris@example.com', 'Борис');

  const profile = await boris.agent.get(`/chitateli/${anna.user.id}`);
  const token = extractCsrf(profile.text);

  const sent = await boris.agent.post('/soobshcheniya').type('form')
    .send({ _csrf: token, recipient: String(anna.user.id), body: 'Привет! Что читаете?' });
  assert.equal(sent.status, 303);
  assert.match(sent.headers.location, /^\/soobshcheniya\/\d+$/);

  // Второе сообщение в тот же диалог — диалог не дублируется
  await boris.agent.post(sent.headers.location).type('form')
    .send({ _csrf: token, body: 'И ещё вопрос' });
  assert.equal(await ctx.models.Conversation.count(), 1, 'диалог должен быть один');

  // Анна видит непрочитанные (2) и открывает диалог
  const inbox = await anna.agent.get('/soobshcheniya');
  assert.match(inbox.text, /pill--amber">2</);

  const dialog = await anna.agent.get(sent.headers.location);
  assert.equal(dialog.status, 200);
  assert.match(dialog.text, /Привет! Что читаете\?/);
  assert.match(dialog.text, /И ещё вопрос/);

  // Прочитано — счётчик обнулился
  assert.equal(await ctx.models.Message.count({ where: { readAt: null } }), 0);
  const inboxAfter = await anna.agent.get('/soobshcheniya');
  assert.ok(!/pill--amber">2</.test(inboxAfter.text));

  // Ответное сообщение помечено как «своё» у Анны
  const reply = await anna.agent.post(sent.headers.location).type('form')
    .send({ _csrf: anna.token, body: 'Читаю «Дюну», очень нравится' });
  assert.equal(reply.status, 303);
  const dialog2 = await anna.agent.get(sent.headers.location);
  assert.match(dialog2.text, /message--own/);
});

test('чужой диалог нельзя прочитать даже зная номер', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signInAs(ctx, 'anna@example.com', 'Анна');
  const boris = await signInAs(ctx, 'boris@example.com', 'Борис');
  const vera = await signInAs(ctx, 'vera@example.com', 'Вера');

  const result = await ctx.services.socialService.sendMessage({
    senderId: boris.user.id, recipientId: anna.user.id, body: 'Секретное сообщение'
  });

  const foreign = await vera.agent.get(`/soobshcheniya/${result.conversation.id}`);
  assert.equal(foreign.status, 404, 'чужой диалог должен отдавать 404');
  assert.ok(!foreign.text.includes('Секретное сообщение'));

  // И отправить в чужой диалог тоже нельзя
  const send = await vera.agent.post(`/soobshcheniya/${result.conversation.id}`).type('form')
    .send({ _csrf: vera.token, body: 'Влезаю в чужой разговор' });
  assert.equal(send.status, 303);
  assert.equal(await ctx.models.Message.count({ where: { body: 'Влезаю в чужой разговор' } }), 0);

  // Сам участник видит
  const own = await anna.agent.get(`/soobshcheniya/${result.conversation.id}`);
  assert.equal(own.status, 200);
  assert.match(own.text, /Секретное сообщение/);
});

test('сообщения: пустое и слишком длинное не отправляются', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signInAs(ctx, 'anna@example.com', 'Анна');
  const boris = await signInAs(ctx, 'boris@example.com', 'Борис');

  const profile = await boris.agent.get(`/chitateli/${anna.user.id}`);
  const token = extractCsrf(profile.text);

  for (const body of ['', '   ', 'а'.repeat(4001)]) {
    const response = await boris.agent.post('/soobshcheniya').type('form')
      .send({ _csrf: token, recipient: String(anna.user.id), body });
    assert.equal(response.status, 303);
  }
  assert.equal(await ctx.models.Message.count(), 0);
});

test('цитаты: сохраняются с ограничением 300 знаков', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signInAs(ctx, 'anna@example.com', 'Анна');
  await makeBook(ctx, { slug: 'duna', title: 'Дюна' });

  const page = await anna.agent.get('/knigi/duna');
  const token = extractCsrf(page.text);
  assert.match(page.text, /Своя цитата/);

  const saved = await anna.agent.post('/knigi/duna/tsitata').type('form')
    .send({ _csrf: token, body: 'Страх — убийца разума.', page: '12' });
  assert.equal(saved.status, 303);

  const quote = await ctx.models.Quote.findOne();
  assert.equal(quote.body, 'Страх — убийца разума.');
  assert.equal(quote.page, 12);

  const bookPage = await anna.agent.get('/knigi/duna');
  assert.match(bookPage.text, /Страх — убийца разума/);
  assert.match(bookPage.text, /Анна/);

  // Слишком длинная цитата отклоняется
  const tooLong = await anna.agent.post('/knigi/duna/tsitata').type('form')
    .send({ _csrf: token, body: 'а'.repeat(301) });
  assert.equal(tooLong.status, 303);
  assert.equal(await ctx.models.Quote.count(), 1, 'длинная цитата не сохранилась');
});

test('гость не попадает в социальные разделы', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  for (const path of ['/lenta', '/chitateli', '/uvedomleniya', '/soobshcheniya']) {
    const response = await ctx.request.get(path);
    assert.equal(response.status, 303, `${path} должен уводить на вход`);
    assert.equal(response.headers.location, '/vhod');
  }
});

test('типы уведомлений и ленты ограничены белым списком', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const anna = await signInAs(ctx, 'anna@example.com', 'Анна');

  const badFeed = await ctx.services.socialService.record({ userId: anna.user.id, type: 'hack' });
  assert.equal(badFeed.error, 'Неизвестный тип события');

  const badNotify = await ctx.services.socialService.notify({ userId: anna.user.id, type: 'hack', title: 'x' });
  assert.equal(badNotify.error, 'Неизвестный тип уведомления');

  assert.equal(await ctx.models.Activity.count(), 0);
  assert.equal(await ctx.models.Notification.count(), 0);
});
