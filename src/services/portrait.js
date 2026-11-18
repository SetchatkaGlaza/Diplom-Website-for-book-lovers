'use strict';

const crypto = require('node:crypto');

/**
 * Аватары читателей и портреты авторов.
 *
 * Чего не делаем:
 *  - не берём чужие фотографии из интернета: у людей есть право на
 *    изображение, а у авторов — наследники и издатели;
 *  - не генерируем «фотореалистичные лица»: поддельный портрет реального
 *    человека вводит в заблуждение, особенно на странице автора.
 *
 * Что делаем: типографические и геометрические знаки. Аватар — монограмма
 * на цветном поле, цвет выбирается хешем от id: у человека он не меняется.
 * Портрет автора — «экслибрис»: инициалы в рамке и узор по хэшу имени,
 * в палитре жанра, в котором автор пишет.
 */

const AVATAR_PALETTE = [
  { bg: '#2b5041', ink: '#fbfaf7' },
  { bg: '#7b3f2f', ink: '#fbfaf7' },
  { bg: '#1d3a52', ink: '#fbfaf7' },
  { bg: '#6c2f45', ink: '#fbfaf7' },
  { bg: '#33302a', ink: '#f5b935' },
  { bg: '#3b3a5c', ink: '#fbfaf7' },
  { bg: '#1f5c5a', ink: '#fbfaf7' },
  { bg: '#b9762f', ink: '#1a1512' },
  { bg: '#efe7d6', ink: '#121314' },
  { bg: '#1c2b3a', ink: '#f5b935' }
];

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function digestOf(value) {
  return crypto.createHash('sha1').update(String(value || '')).digest();
}

/** Первые буквы имени: «Анна Петрова» → «АП», «Анна» → «А». */
function initials(name) {
  const parts = String(name || '')
    .replace(/[^\p{L}\s-]/gu, ' ')
    .split(/[\s-]+/)
    .filter(Boolean);
  if (!parts.length) return 'Ч';
  const first = parts[0][0] || 'Ч';
  const second = parts.length > 1 ? parts[1][0] : '';
  return (first + second).toUpperCase();
}

/**
 * Аватар: круг с монограммой и тонким кольцом.
 * pivot — то, от чего зависит цвет (id пользователя).
 */
function buildAvatarSvg({ name, pivot = '', size = 160 }) {
  const palette = AVATAR_PALETTE[digestOf(pivot || name)[0] % AVATAR_PALETTE.length];
  const letters = initials(name);
  const fontSize = letters.length > 1 ? Math.round(size * 0.36) : Math.round(size * 0.44);
  const ring = Math.round(size * 0.03);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Аватар: ${escapeXml(name || 'читатель')}">
  <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${palette.bg}"/>
  <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - ring * 1.5}" fill="none" stroke="${palette.ink}" stroke-width="${ring}" opacity="0.28"/>
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
        font-family="DejaVu Sans, Helvetica, Arial, sans-serif"
        font-size="${fontSize}" font-weight="700" letter-spacing="1"
        fill="${palette.ink}">${escapeXml(letters)}</text>
</svg>`;
}

/**
 * Портрет автора: «экслибрис» — инициалы в рамке, узор по имени.
 * Не фотография и не карикатура: знак, а не лицо.
 */
function buildAuthorSvg({ name, years = '', size = 480, accent = '#c99a2e', paper = '#f4f1ea', ink = '#121314' }) {
  const padding = Math.round(size * 0.08);
  const inner = size - padding * 2;
  const letters = initials(name);
  const digest = digestOf(name);
  const variant = digest[0] % 3;
  const fontSize = Math.round(size * 0.3);

  const ornaments = [
    `<circle cx="${size / 2}" cy="${padding + inner * 0.22}" r="${Math.round(inner * 0.10)}" fill="none" stroke="${accent}" stroke-width="2" opacity="0.6"/>`,
    `<path d="M ${padding} ${padding + inner * 0.2} L ${size - padding} ${padding + inner * 0.2}" stroke="${accent}" stroke-width="2" opacity="0.55"/>`,
    `<rect x="${padding + inner * 0.06}" y="${padding + inner * 0.1}" width="${Math.round(inner * 0.12)}" height="${Math.round(inner * 0.12)}" fill="none" stroke="${accent}" stroke-width="2" opacity="0.5"/>`
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Портрет автора: ${escapeXml(name)}">
  <rect width="${size}" height="${size}" fill="${paper}"/>
  <rect x="${padding / 2}" y="${padding / 2}" width="${size - padding}" height="${size - padding}"
        fill="none" stroke="${ink}" stroke-opacity="0.18" stroke-width="1.5"/>
  ${ornaments[variant]}
  <text x="50%" y="52%" text-anchor="middle" dominant-baseline="central"
        font-family="DejaVu Serif, Georgia, serif" font-size="${fontSize}" font-weight="700"
        fill="${ink}" letter-spacing="-2">${escapeXml(letters)}</text>
  <text x="50%" y="${size - padding - Math.round(size * 0.06)}" text-anchor="middle"
        font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-size="${Math.round(size * 0.052)}"
        fill="${ink}" opacity="0.55" letter-spacing="2">${escapeXml(String(name || '').toUpperCase())}</text>
  ${years ? `<text x="50%" y="${size - padding - Math.round(size * 0.015)}" text-anchor="middle"
        font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-size="${Math.round(size * 0.038)}"
        fill="${ink}" opacity="0.38" letter-spacing="2">${escapeXml(years)}</text>` : ''}
</svg>`;
}

/**
 * Обложка клуба: широкий баннер. Название крупно, участники и встречи —
 * подписью. Используется как шапка страницы клуба.
 */
function buildClubSvg({ name, members = 0, meetings = 0, size = { width: 1200, height: 420 } }) {
  const { width, height } = size;
  const digest = digestOf(name);
  const palette = AVATAR_PALETTE[digest[0] % AVATAR_PALETTE.length];
  const variant = digest[1] % 3;
  const pad = Math.round(width * 0.055);
  const titleSize = Math.min(Math.round(height * 0.18), Math.round((width - pad * 2) / Math.max(6, String(name || '').length) / 0.56));

  const decor = [
    `<circle cx="${width - pad}" cy="${height * 0.2}" r="${Math.round(width * 0.14)}" fill="none" stroke="${palette.ink}" stroke-width="3" opacity="0.25"/>`,
    `<path d="M 0 ${height * 0.78} L ${width} ${height * 0.62} L ${width} ${height} L 0 ${height} Z" fill="${palette.ink}" opacity="0.07"/>`,
    `<rect x="${width - pad - Math.round(width * 0.16)}" y="${height * 0.24}" width="${Math.round(width * 0.16)}" height="${Math.round(width * 0.16)}" fill="none" stroke="${palette.ink}" stroke-width="3" opacity="0.22" transform="rotate(14 ${width - pad - 100} ${height * 0.4})"/>`
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Обложка клуба: ${escapeXml(name)}">
  <rect width="${width}" height="${height}" fill="${palette.bg}"/>
  ${decor[variant]}
  <text x="${pad}" y="${Math.round(height * 0.38)}" font-family="DejaVu Sans, Helvetica, Arial, sans-serif"
        font-size="${Math.round(height * 0.045)}" fill="${palette.ink}" opacity="0.6" letter-spacing="3">КЛУБ КНИГОМАНОВ</text>
  <text x="${pad}" y="${Math.round(height * 0.64)}" font-family="DejaVu Serif, Georgia, serif"
        font-size="${titleSize}" font-weight="700" fill="${palette.ink}" letter-spacing="-1">${escapeXml(name)}</text>
  <text x="${pad}" y="${Math.round(height * 0.82)}" font-family="DejaVu Sans, Helvetica, Arial, sans-serif"
        font-size="${Math.round(height * 0.045)}" fill="${palette.ink}" opacity="0.7" letter-spacing="1">${members} участников · ${meetings} встреч</text>
</svg>`;
}

module.exports = { buildAvatarSvg, buildAuthorSvg, buildClubSvg, initials, AVATAR_PALETTE };
