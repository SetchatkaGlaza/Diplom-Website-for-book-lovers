'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { describeDatabaseError } = require('../../src/lib/errors');

/**
 * Ошибка базы на странице 500.
 *
 * Человек, который забыл миграции, должен увидеть «выполните npm run
 * db:migrate», а не «Внутренняя ошибка сервера» — иначе он идёт читать
 * шаблоны вместо того, чтобы запустить одну команду.
 */
test('ошибки базы объясняются по-человечески', () => {
  assert.match(
    describeDatabaseError({ message: 'relation "books" does not exist' }),
    /db:migrate/
  );
  assert.match(
    describeDatabaseError({ message: 'database "knigomany" does not exist' }),
    /База с таким именем не создана/
  );
  assert.match(
    describeDatabaseError({ message: 'connect ECONNREFUSED 127.0.0.1:5432' }),
    /встроенную базу/
  );
  assert.match(
    describeDatabaseError({ parent: { message: 'password authentication failed' } }),
    /PostgreSQL/,
    'ошибку из parent тоже нужно узнавать'
  );
});

test('не связанные с базой ошибки не подменяются', () => {
  assert.equal(describeDatabaseError({ message: 'undefined is not a function' }), null);
  assert.equal(describeDatabaseError(null), null);
  assert.equal(describeDatabaseError({}), null);
});
