'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dbDriver = require('../../src/config/db-driver');

/**
 * Выбор базы.
 *
 * Это первое, что ломается у человека, который просто скачал проект:
 * без Postgres сайт не стартовал. Правила простые, поэтому и тесты простые:
 *  - явно заданный драйвер уважается всегда;
 *  - без явного выбора недоступный Postgres не мешает запуску;
 *  - подсказки об ошибках переведены на человеческий язык.
 */

function withEnv(vars, fn) {
  const saved = {};
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test('явно заданный драйвер уважается и не проверяет соединение', async () => {
  const probe = async () => { throw new Error('проверка не должна вызываться'); };

  await withEnv({ DB_DRIVER: 'pglite' }, async () => {
    const choice = await dbDriver.resolveDriver({ probe });
    assert.equal(choice.driver, 'pglite');
  });

  await withEnv({ DB_DRIVER: 'postgres' }, async () => {
    const choice = await dbDriver.resolveDriver({ probe });
    assert.equal(choice.driver, 'postgres');
  });
});

test('синонимы драйверов понимаются', async () => {
  for (const [value, expected] of [['PG', 'postgres'], ['embedded', 'pglite'], ['postgres', 'postgres']]) {
    await withEnv({ DB_DRIVER: value }, async () => {
      assert.equal(dbDriver.requestedDriver(), expected, `DB_DRIVER=${value}`);
    });
  }
  await withEnv({ DB_DRIVER: undefined }, async () => {
    assert.equal(dbDriver.requestedDriver(), null);
  });
});

test('без явного выбора: живой Postgres берётся, мёртвый — подменяется встроенным', async () => {
  await withEnv({ DB_DRIVER: undefined }, async () => {
    const alive = await dbDriver.resolveDriver({ probe: async () => ({ ok: true }) });
    assert.equal(alive.driver, 'postgres');
    assert.match(alive.reason, /отвечает/);

    const dead = await dbDriver.resolveDriver({
      probe: async () => ({ ok: false, error: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) })
    });
    assert.equal(dead.driver, 'pglite', 'без Postgres проект должен всё равно запуститься');
    assert.match(dead.reason, /не запущен/);
  });
});

test('ошибки Postgres переводятся в понятные подсказки', () => {
  assert.match(dbDriver.errorHint({ message: 'database "knigomany" does not exist' }), /базы с таким именем нет/);
  assert.match(dbDriver.errorHint({ message: 'connect ECONNREFUSED 127.0.0.1:5432' }), /не запущен/);
  assert.match(dbDriver.errorHint({ message: 'password authentication failed' }), /пароль/);
  assert.match(dbDriver.errorHint({ message: 'getaddrinfo ENOTFOUND db.example' }), /хост/);
  assert.match(dbDriver.errorHint(new Error('что-то своё')), /DATABASE_URL/);
});

test('папка данных: по умолчанию .data, PGLITE_DATA_DIR переопределяет', () => {
  withEnv({ PGLITE_DATA_DIR: undefined }, () => {
    assert.equal(dbDriver.dataDir(), path.resolve('.data'));
  });

  const custom = path.join(os.tmpdir(), 'knigomany-test-data');
  withEnv({ PGLITE_DATA_DIR: custom }, () => {
    assert.equal(dbDriver.dataDir(), path.resolve(custom));
  });

  // Пустая строка — тоже «не задано»: иначе база уедет в корень диска
  withEnv({ PGLITE_DATA_DIR: '   ' }, () => {
    assert.equal(dbDriver.dataDir(), path.resolve('.data'));
  });
});

test('папка с базой не попадает в git', () => {
  const ignore = fs.readFileSync(path.join(__dirname, '..', '..', '.gitignore'), 'utf8');
  assert.match(ignore, /^\.data\/$/m, '.data должна быть в .gitignore');
  assert.match(ignore, /^\.preview-data\/?$/m, '.preview-data должна быть в .gitignore');
});
