'use strict';

/**
 * Контраст двух цветов по формуле WCAG.
 *
 * Нужен тестам и проверке палитры: если пара «текст / фон» даёт меньше
 * 4.5:1, мелкий текст на ней читать тяжело. Возвращает число от 1 до 21.
 */

function parseHex(hex) {
  const value = String(hex || '').trim().replace('#', '');
  const full = value.length === 3
    ? value.split('').map((symbol) => symbol + symbol).join('')
    : value;
  if (!/^[0-9a-f]{6}$/i.test(full)) {
    throw new Error(`Не цвет: ${hex}`);
  }
  return [
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255
  ];
}

function relativeLuminance(hex) {
  const [r, g, b] = parseHex(hex).map((channel) => (
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Отношение контраста: 21 — чёрное на белом, 1 — одинаковые цвета. */
function contrast(a, b) {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const light = Math.max(first, second);
  const dark = Math.min(first, second);
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100;
}

/** Для кнопок: 3:1 достаточно для крупного текста, 4.5:1 — для обычного. */
function isReadable(a, b, min = 4.5) {
  return contrast(a, b) >= min;
}

module.exports = { contrast, isReadable, relativeLuminance };
