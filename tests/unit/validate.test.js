'use strict';

require('../support/env');

const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../../src/lib/validate');
const { HttpError } = require('../../src/lib/errors');

test('e-mail: нормализация и типичные опечатки', () => {
  assert.equal(v.email('reader@example.com').value, 'reader@example.com');
  assert.equal(v.email('  READER@Example.COM  ').value, 'reader@example.com');
  assert.ok(v.email('reader@example').error, 'без зоны');
  assert.ok(v.email('reader example@mail.ru').error, 'пробел');
  assert.ok(v.email('reader@mail..ru').error, 'две точки');
  assert.ok(v.email('').error);
  assert.ok(v.email(`${'a'.repeat(70)}@mail.ru`).error, 'длинная часть до @');
});

test('пароль: длина, буква, цифра, словарные пароли', () => {
  assert.equal(v.password('reader2026').value, 'reader2026');
  assert.equal(v.password('Мастер123').value, 'Мастер123');
  assert.ok(v.password('qwertyqq').error, 'без цифры');
  assert.ok(v.password('12345678').error, 'без буквы');
  assert.ok(v.password('1234').error, 'короткий');
  assert.ok(v.password('password1').error, 'словарный');
  assert.ok(v.password('admin2026').error, 'admin');
});

test('пароль с подтверждением', () => {
  assert.equal(v.passwordPair('reader2026', 'reader2026').value, 'reader2026');
  assert.equal(v.passwordPair('reader2026', 'reader2027').error, 'Пароли не совпадают');
});

test('имя: пробелы, запрет символов', () => {
  assert.equal(v.name('Анна').value, 'Анна');
  assert.equal(v.name('  Анна   Мария ').value, 'Анна Мария');
  assert.equal(v.name("О'Брайен").value, "О'Брайен");
  assert.ok(v.name('А').error);
  assert.ok(v.name('   ').error);
  assert.ok(v.name('<script>').error);
});

test('управляющие символы вырезаются', () => {
  assert.equal(v.str('текст\u0000с\u001fсимволами'), 'текстссимволами');
  assert.equal(v.text('  привет  ', { max: 100 }).value, 'привет');
});

test('оценка: диапазон и шаг 0.5', () => {
  assert.equal(v.rating('4.5').value, 4.5);
  assert.equal(v.rating(5).value, 5);
  assert.ok(v.rating('4.2').error);
  assert.ok(v.rating('0').error);
  assert.ok(v.rating('6').error);
  assert.ok(v.rating('abc').error);
});

test('int, oneOf, bool, slug', () => {
  assert.equal(v.int('42', { min: 0, max: 100 }).value, 42);
  assert.ok(v.int('1000', { min: 0, max: 100 }).error);
  assert.ok(v.int('abc', { min: 0, max: 100 }).error);
  assert.equal(v.oneOf('read', ['want', 'reading', 'read', 'dnf']).value, 'read');
  assert.ok(v.oneOf('hacked', ['want', 'reading']).error);
  assert.equal(v.bool('on'), true);
  assert.equal(v.bool('false'), false);
  assert.equal(v.slug('master-i-margarita').value, 'master-i-margarita');
  assert.ok(v.slug('Мастер и Маргарита').error);
  assert.ok(v.slug('a"b').error);
});

test('HttpError несёт статус и код', () => {
  const error = HttpError.notFound('нет');
  assert.equal(error.status, 404);
  assert.equal(error.message, 'нет');
  assert.equal(HttpError.forbidden().status, 403);
  assert.equal(HttpError.tooMany().status, 429);
});
