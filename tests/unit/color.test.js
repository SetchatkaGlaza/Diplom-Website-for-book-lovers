'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { contrast, isReadable, relativeLuminance } = require('../../src/lib/color');

test('контраст считает крайние случаи правильно', () => {
  assert.equal(contrast('#000000', '#ffffff'), 21);
  assert.equal(contrast('#ffffff', '#ffffff'), 1);
  // порядок цветов не важен
  assert.equal(contrast('#121314', '#fbfaf7'), contrast('#fbfaf7', '#121314'));
});

test('короткая запись цвета понимается так же, как полная', () => {
  assert.equal(contrast('#fff', '#000'), 21);
  assert.equal(contrast('000', 'fff'), 21);
});

test('мусор вместо цвета даёт понятную ошибку', () => {
  assert.throws(() => contrast('не цвет', '#fff'), /Не цвет/);
  assert.throws(() => contrast('#12345', '#fff'), /Не цвет/);
  assert.throws(() => relativeLuminance(''), /Не цвет/);
});

test('порог читаемости настраивается', () => {
  // серый #707070 на чёрном даёт 4.24 — мало для текста, но хватит для крупной кнопки
  const value = contrast('#707070', '#000000');
  assert.equal(isReadable('#707070', '#000000', 4.5), false);
  assert.equal(isReadable('#707070', '#000000', 3), true);
  assert.equal(value > 3 && value < 4.5, true, `ожидалось между 3 и 4.5, вышло ${value}`);
});

test('палитра сайта проходит проверку на читаемость', () => {
  const palette = {
    ink: '#121314', paper: '#fbfaf7', warm: '#f4f1ea',
    muted: '#6b655c', amber: '#f5b935', green: '#2b5041',
    danger: '#c2453a', card: '#ffffff'
  };

  const pairs = [
    ['ink', 'paper'], ['ink', 'warm'], ['ink', 'card'],
    ['muted', 'paper'], ['muted', 'warm'], ['muted', 'card'],
    ['amber', 'ink'], ['green', 'paper'], ['danger', 'card'],
    ['ink', 'amber']
  ];

  for (const [front, back] of pairs) {
    const value = contrast(palette[front], palette[back]);
    assert.ok(value >= 4.5, `${front} на ${back}: ${value} — меньше 4.5`);
  }
});
