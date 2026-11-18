'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp } = require('../support/app');

/**
 * Дизайн-система проверяется без браузера: смотрим на HTML, который отдаёт
 * сервер, и на правила оформления в CSS-файле.
 */

/** Достаёт правила одного селектора из CSS (все вхождения). */
function ruleBlocks(css, selector) {
  const blocks = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const pattern = new RegExp(`(^|[},])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g');
  let match = pattern.exec(clean);
  while (match) {
    blocks.push(match[2]);
    match = pattern.exec(clean);
  }
  return blocks;
}

test('витрина стилей открывается и показывает все компоненты', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const response = await ctx.request.get('/stil');
  assert.equal(response.status, 200);
  assert.match(response.text, /Витрина стилей/);

  for (const piece of [
    'swatch', 'btn btn--primary', 'btn btn--ghost', 'field__input',
    'stat-strip', 'progress__bar', 'book-card', 'empty-state',
    'section--dark', 'banner', 'activity-row', 'avatar'
  ]) {
    assert.ok(response.text.includes(piece), `на витрине нет блока ${piece}`);
  }
});

test('на страницах нет встроенных стилей и скриптов — их не пропустит CSP', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  for (const path of ['/', '/stil', '/vhod', '/registratsiya', '/net-takoy-stranitsy']) {
    const response = await ctx.request.get(path);
    assert.equal(response.status === 200 || response.status === 404, true, `${path}: ${response.status}`);
    const inlineStyles = response.text.match(/<style[\s>]/gi) || [];
    const inlineHandlers = response.text.match(/\son(click|load|error|submit)=/gi) || [];
    const inlineStyleAttrs = response.text.match(/\sstyle="/gi) || [];
    assert.equal(inlineStyles.length, 0, `${path}: есть <style>`);
    assert.equal(inlineHandlers.length, 0, `${path}: есть обработчик в атрибуте`);
    assert.equal(inlineStyleAttrs.length, 0, `${path}: есть атрибут style=""`);
  }
});

test('CSP не разрешает встроенные стили и скрипты', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const response = await ctx.request.get('/');
  const csp = response.headers['content-security-policy'];
  assert.ok(csp, 'заголовок CSP должен быть');
  assert.ok(!/unsafe-inline/.test(csp), 'unsafe-inline не нужен: всё в файлах');
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /style-src 'self'/);
  assert.match(csp, /img-src[^;]*'self'/);
});

test('у каждой страницы есть заголовок, описание и язык', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  for (const path of ['/', '/stil', '/vhod', '/registratsiya', '/vosstanovit-parol']) {
    const response = await ctx.request.get(path);
    const html = response.text;

    const title = (html.match(/<title>([^<]+)<\/title>/) || [])[1] || '';
    assert.ok(title.trim().length > 3, `${path}: пустой <title>`);
    assert.match(html, /<html lang="ru"/, `${path}: нет lang="ru"`);

    const description = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
    assert.ok(description.length >= 40, `${path}: слишком короткое описание`);
    assert.ok(description.length <= 320, `${path}: описание длиннее 320 символов`);

    assert.match(html, /<meta name="viewport"/, `${path}: нет viewport`);
    assert.match(html, /<a class="skip-link" href="#main"/, `${path}: нет ссылки «к содержимому»`);
  }
});

test('тёмная тема включается cookie и запоминается сервером', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const light = await ctx.request.get('/');
  assert.match(light.text, /<html lang="ru" data-theme="light">/);

  const dark = await ctx.request.get('/').set('Cookie', 'theme=dark');
  assert.match(dark.text, /<html lang="ru" data-theme="dark">/);
  assert.match(dark.text, /<meta name="color-scheme" content="light dark">/);

  // Мусор в cookie не ломает страницу
  const broken = await ctx.request.get('/').set('Cookie', 'theme=%FF%00');
  assert.equal(broken.status, 200);
});

test('в оформлении есть токены, тёмная тема и правила для телефона', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const css = (await ctx.request.get('/assets/css/base.css')).text;

  for (const token of [
    '--ink: #121314', '--amber: #f5b935', '--green: #2b5041',
    '--paper: #fbfaf7', '--line: #e6e1d7', '--muted: #6b655c'
  ]) {
    assert.ok(css.includes(token), `в CSS нет токена ${token}`);
  }

  assert.ok(css.includes('[data-theme="dark"]'), 'нет тёмной темы');
  assert.ok(css.includes('@media (max-width: 720px)'), 'нет правил для телефона');
  assert.ok(css.includes('prefers-reduced-motion'), 'нет уважения к «меньше движения»');
  assert.ok(css.includes('.tabbar'), 'нет нижней панели для телефона');

  // Кнопки и поля не меньше 44 px — иначе по ним трудно попасть пальцем
  const btn = ruleBlocks(css, '.btn').join(' ');
  assert.match(btn, /min-height:\s*var\(--tap\)/);
  assert.match(css, /--tap:\s*44px/);
});

test('текст читается: контраст основных пар не ниже нормы', async (t) => {
  const { contrast } = require('../../src/lib/color');
  const pairs = [
    ['#121314', '#fbfaf7', 12],
    ['#6b655c', '#fbfaf7', 4.5],
    ['#6b655c', '#f4f1ea', 4.5],
    ['#f5b935', '#121314', 7],
    ['#121314', '#f5b935', 7],
    ['#2b5041', '#fbfaf7', 4.5],
    ['#c2453a', '#ffffff', 4.5],
    ['#a8aeb2', '#121314', 4.5]
  ];
  for (const [front, back, min] of pairs) {
    const value = contrast(front, back);
    assert.ok(value >= min, `${front} на ${back}: ${value.toFixed(2)} меньше ${min}`);
  }
});
