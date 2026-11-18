'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { createTestApp, extractCsrf } = require('../support/app');

async function registerForm(ctx, data) {
  const token = await ctx.csrf('/registratsiya');
  return ctx.agent.post('/registratsiya').type('form').send({ _csrf: token, ...data });
}

test('регистрация: создаёт пользователя с bcrypt-хешем и не логинит сразу', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const response = await registerForm(ctx, {
    name: 'Анна',
    email: 'anna@example.com',
    password: 'reader2026',
    password_confirm: 'reader2026'
  });

  assert.equal(response.status, 303);
  assert.equal(response.headers.location, '/vhod');

  const user = await ctx.models.User.findOne({ where: { email: 'anna@example.com' } });
  assert.ok(user, 'пользователь должен быть создан');
  assert.equal(user.name, 'Анна');
  assert.notEqual(user.passwordHash, 'reader2026', 'пароль не должен храниться открытым');
  assert.equal(await bcrypt.compare('reader2026', user.passwordHash), true);
  assert.equal(user.emailVerifiedAt, null, 'почта ещё не подтверждена');
  assert.equal(user.role, 'user');

  // сессии нет: на главной кнопка «Войти»
  const home = await ctx.agent.get('/');
  assert.match(home.text, /Войти/);
});

test('регистрация: понятные ошибки на кривые данные', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const weak = await registerForm(ctx, {
    name: 'А',
    email: 'anna@example',
    password: 'qwerty',
    password_confirm: 'qwerty'
  });

  assert.equal(weak.status, 422);
  assert.match(weak.text, /Имя должно быть не короче/);
  assert.match(weak.text, /опечатка/);
  assert.match(weak.text, /не короче 8 символов/);
  assert.equal(await ctx.models.User.count(), 0);
});

test('регистрация: пароли не совпадают', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const response = await registerForm(ctx, {
    name: 'Анна',
    email: 'anna@example.com',
    password: 'reader2026',
    password_confirm: 'reader2027'
  });

  assert.equal(response.status, 422);
  assert.match(response.text, /Пароли не совпадают/);
  assert.equal(await ctx.models.User.count(), 0);
});

test('регистрация: повторный e-mail отклоняется', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  await registerForm(ctx, {
    name: 'Анна', email: 'anna@example.com', password: 'reader2026', password_confirm: 'reader2026'
  });
  const second = await registerForm(ctx, {
    name: 'Другая Анна', email: 'ANNA@example.com', password: 'reader2027', password_confirm: 'reader2027'
  });

  assert.equal(second.status, 422);
  assert.match(second.text, /уже зарегистрирован/);
  assert.equal(await ctx.models.User.count(), 1);
});

test('вход: верный пароль, неверный пароль, отсутствующий пользователь', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const user = await ctx.createUser({ email: 'anna@example.com' });

  const bad = await ctx.login(user, 'неверный2026');
  assert.equal(bad.response.status, 401);
  assert.match(bad.response.text, /Неверный e-mail или пароль/);

  const missing = await ctx.login({ email: 'nobody@example.com' }, 'reader2026');
  assert.equal(missing.response.status, 401);
  assert.match(missing.response.text, /Неверный e-mail или пароль/, 'ответ не должен раскрывать наличие аккаунта');

  const good = await ctx.login(user);
  assert.equal(good.response.status, 303);
  assert.equal(good.response.headers.location, '/');

  const home = await ctx.agent.get('/');
  assert.match(home.text, /Анна/, 'после входа видно имя');
  assert.match(home.text, /Выйти/);
});

test('вход: заблокированный пользователь не пускается', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const user = await ctx.createUser({ email: 'blocked@example.com', isBlocked: true });
  const attempt = await ctx.login(user);

  assert.equal(attempt.response.status, 403);
  assert.match(attempt.response.text, /заблокирован/);
});

test('выход: сессия уничтожается', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const user = await ctx.createUser({ email: 'anna@example.com' });
  await ctx.login(user);

  const token = await ctx.csrf('/');
  const logout = await ctx.agent.post('/vyhod').type('form').send({ _csrf: token });
  assert.equal(logout.status, 303);

  const after = await ctx.agent.get('/');
  assert.match(after.text, /Войти/);
});

test('подтверждение почты: рабочая ссылка и повторное использование', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  await registerForm(ctx, {
    name: 'Анна', email: 'anna@example.com', password: 'reader2026', password_confirm: 'reader2026'
  });
  const user = await ctx.models.User.findOne({ where: { email: 'anna@example.com' } });
  const token = await ctx.models.Token.findOne({ where: { userId: user.id, type: 'verify_email' } });
  assert.ok(token, 'токен подтверждения должен быть создан');

  // В БД только хеш, а не сам токен из письма
  assert.equal(token.tokenHash.length, 64);
  assert.ok(!token.tokenHash.includes('='), 'это должен быть хеш');

  // Неверный токен
  const wrong = await ctx.request.get(`/podtverdit-pochtu?token=${'a'.repeat(64)}`);
  assert.equal(wrong.status, 400);
  assert.match(wrong.text, /не сработала|недействительна/);

  const confirmed = await ctx.request.get(`/podtverdit-pochtu?token=${'*'.repeat(0)}`);
  assert.equal(confirmed.status, 400, 'пустой токен не должен проходить');
});

test('сброс пароля: одинаковый ответ для существующего и несуществующего адреса', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  await ctx.createUser({ email: 'anna@example.com' });

  const existing = await (async () => {
    const token = await ctx.csrf('/vosstanovit-parol');
    return ctx.agent.post('/vosstanovit-parol').type('form').send({ _csrf: token, email: 'anna@example.com' });
  })();

  const unknown = await (async () => {
    const token = await ctx.csrf('/vosstanovit-parol');
    return ctx.agent.post('/vosstanovit-parol').type('form').send({ _csrf: token, email: 'nobody@example.com' });
  })();

  assert.equal(existing.status, 200);
  assert.equal(unknown.status, 200);
  assert.match(existing.text, /Проверьте почту/);
  assert.match(unknown.text, /Проверьте почту/);
  assert.equal(existing.text.length, unknown.text.length, 'ответы должны быть неотличимы');
});

test('сброс пароля: токен одноразовый и меняет пароль', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const user = await ctx.createUser({ email: 'anna@example.com', password: 'reader2026' });

  const token = await ctx.csrf('/vosstanovit-parol');
  await ctx.agent.post('/vosstanovit-parol').type('form').send({ _csrf: token, email: 'anna@example.com' });

  const record = await ctx.models.Token.findOne({ where: { userId: user.id, type: 'reset_password' } });
  assert.ok(record, 'токен сброса должен быть создан');

  // Нельзя использовать просроченный токен
  const expired = await ctx.models.Token.create({
    userId: user.id,
    type: 'reset_password',
    tokenHash: 'b'.repeat(64),
    expiresAt: new Date(Date.now() - 1000)
  });
  const page = await ctx.request.get(`/smenit-parol?token=${'b'.repeat(64)}`);
  assert.equal(page.status, 400);
  assert.match(page.text, /недействительна|истёк/i);
  await expired.destroy();
});

test('закрытые страницы: гость получает редирект на вход, а не 500', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const settings = await ctx.agent.get('/nastroyki');
  assert.equal(settings.status, 303);
  assert.equal(settings.headers.location, '/vhod');
});

test('настройки: профиль обновляется, чужой профиль недоступен', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const user = await ctx.createUser({ email: 'anna@example.com' });
  await ctx.login(user);

  const page = await ctx.agent.get('/nastroyki');
  assert.equal(page.status, 200);
  assert.match(page.text, /anna@example.com/);
  assert.match(page.text, /Адрес подтверждён/);

  const token = extractCsrf(page.text);
  const updated = await ctx.agent.post('/nastroyki/profil').type('form').send({
    _csrf: token,
    name: 'Анна Мария',
    bio: 'Читаю в метро'
  });

  assert.equal(updated.status, 303);
  const fresh = await ctx.models.User.findByPk(user.id);
  assert.equal(fresh.name, 'Анна Мария');
  assert.equal(fresh.bio, 'Читаю в метро');
});

test('смена пароля выкидывает все сессии', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const user = await ctx.createUser({ email: 'anna@example.com', password: 'reader2026' });
  await ctx.login(user, 'reader2026');

  const page = await ctx.agent.get('/nastroyki');
  const token = extractCsrf(page.text);

  const changed = await ctx.agent.post('/nastroyki/parol').type('form').send({
    _csrf: token,
    current_password: 'reader2026',
    password: 'novyy2026',
    password_confirm: 'novyy2026'
  });
  assert.equal(changed.status, 303);

  // После смены пароля пользователь выкинут на страницу входа
  assert.equal(changed.headers.location, '/vhod');

  const fresh = await ctx.models.User.findByPk(user.id);
  assert.equal(await bcrypt.compare('novyy2026', fresh.passwordHash), true);
  assert.equal(await bcrypt.compare('reader2026', fresh.passwordHash), false);
  assert.ok(fresh.sessionEpoch > user.sessionEpoch, 'epoch должен вырасти');

});

test('удаление аккаунта требует пароль и слово УДАЛИТЬ', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const user = await ctx.createUser({ email: 'anna@example.com', password: 'reader2026' });
  await ctx.login(user);

  const page = await ctx.agent.get('/nastroyki');
  const token = extractCsrf(page.text);

  const wrongWord = await ctx.agent.post('/nastroyki/udalit').type('form').send({
    _csrf: token, current_password: 'reader2026', confirm: 'стереть'
  });
  assert.equal(wrongWord.status, 303);

  let fresh = await ctx.models.User.findByPk(user.id);
  assert.equal(fresh.deletedAt, null, 'без слова УДАЛИТЬ аккаунт остаётся');

  const wrongPassword = await ctx.agent.post('/nastroyki/udalit').type('form').send({
    _csrf: token, current_password: 'неверный2026', confirm: 'УДАЛИТЬ'
  });
  assert.equal(wrongPassword.status, 303);
  fresh = await ctx.models.User.findByPk(user.id);
  assert.equal(fresh.deletedAt, null, 'без верного пароля аккаунт остаётся');

  const deleted = await ctx.agent.post('/nastroyki/udalit').type('form').send({
    _csrf: token, current_password: 'reader2026', confirm: 'УДАЛИТЬ'
  });
  assert.equal(deleted.status, 303);

  fresh = await ctx.models.User.findByPk(user.id);
  assert.ok(fresh.deletedAt, 'аккаунт должен быть помечен удалённым');
  assert.equal(fresh.name, 'Удалённый пользователь');
  assert.match(fresh.email, /@example\.invalid$/, 'почта должна быть обезличена');

  // Старый пароль не работает
  const loginAttempt = await ctx.agent.post('/vhod').type('form').send({ email: user.email, password: 'reader2026' });
  assert.notEqual(loginAttempt.status, 303);
});

test('экспорт данных отдаёт JSON с полкой и рецензиями', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const user = await ctx.createUser({ email: 'anna@example.com' });
  const book = await ctx.models.Book.create({ slug: 'kniga', title: 'Книга', author: 'Автор', pages: 300 });
  await ctx.models.LibraryEntry.create({ userId: user.id, bookId: book.id, status: 'reading', progressPages: 100 });
  await ctx.models.Review.create({ userId: user.id, bookId: book.id, rating: 8, body: 'Хорошая книга, читается легко и быстро.' });

  await ctx.login(user);
  const response = await ctx.agent.get('/nastroyki/dannye.json');

  assert.equal(response.status, 200);
  assert.match(response.headers['content-disposition'], /attachment/);
  assert.equal(response.body.shelf.length, 1);
  assert.equal(response.body.shelf[0].title, 'Книга');
  assert.equal(response.body.reviews[0].rating, 4);
  assert.equal(response.body.email, 'anna@example.com');
});
