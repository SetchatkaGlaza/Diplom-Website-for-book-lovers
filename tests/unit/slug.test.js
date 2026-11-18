'use strict';

require('../support/env');

const test = require('node:test');
const assert = require('node:assert/strict');
const { slugify, uniqueSlug } = require('../../src/lib/slug');

test('транслитерация русского названия', () => {
  assert.equal(slugify('Мастер и Маргарита'), 'master-i-margarita');
  assert.equal(slugify('1984'), '1984');
  assert.equal(slugify('Щегол'), 'shchegol');
  assert.equal(slugify('Ёжик в тумане'), 'ezhik-v-tumane');
});

test('спецсимволы и пробелы не ломают слаг', () => {
  assert.equal(slugify('  Тень   горы  '), 'ten-gory');
  assert.equal(slugify('С++ для начинающих!'), 's-dlya-nachinayushchih');
  assert.equal(slugify('Щука и щенок'), 'shchuka-i-shchenok');
  assert.equal(slugify('!!!'), 'item');
  assert.equal(slugify('!!!', 'kniga'), 'kniga');
});

test('uniqueSlug добавляет суффикс при совпадении', () => {
  const taken = new Set(['ten-gory']);
  const exists = async (slug) => taken.has(slug);
  return uniqueSlug('Тень горы', exists).then((slug) => {
    assert.equal(slug, 'ten-gory-2');
  });
});
