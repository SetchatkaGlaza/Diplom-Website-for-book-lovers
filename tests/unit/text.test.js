'use strict';

require('../support/env');

const test = require('node:test');
const assert = require('node:assert/strict');
const text = require('../../src/lib/text');

test('склонение: книга', () => {
  const forms = ['книга', 'книги', 'книг'];
  assert.equal(text.plural(1, forms), 'книга');
  assert.equal(text.plural(2, forms), 'книги');
  assert.equal(text.plural(5, forms), 'книг');
  assert.equal(text.count(3, forms), '3 книги');
  assert.throws(() => text.plural(1, ['книга']), /трёх форм/);
});

test('склонение: исключения 11–14', () => {
  const f = ['книга', 'книги', 'книг'];
  assert.equal(text.plural(11, f), 'книг');
  assert.equal(text.plural(12, f), 'книг');
  assert.equal(text.plural(113, f), 'книг');
  assert.equal(text.plural(21, f), 'книга');
  assert.equal(text.plural(1024, ['страница', 'страницы', 'страниц']), 'страницы');
  assert.equal(text.plural(0, f), 'книг');
  assert.equal(text.days(3), '3 дня');
  assert.equal(text.plural(1, ['только', 'одна', 'форма']), 'только');
});

test('truncate не режет по слогу', () => {
  const long = 'Очень длинный текст про книгу, который не помещается в карточку';
  const cut = text.truncate(long, 20);
  assert.ok(cut.length <= 21, `получили: ${cut}`);
  assert.ok(cut.endsWith('…'));
});
