'use strict';

const crypto = require('node:crypto');

/**
 * Обложки книг, нарисованные типографикой.
 *
 * Почему генерируем, а не храним 345 картинок в репозитории:
 *  - книг много, и каждая новая книга получает обложку сразу, без ручной
 *    работы и без битых ссылок;
 *  - обложка детерминирована: тот же слаг — та же картинка, поэтому её
 *    можно кэшировать навсегда и она не «мигает» между заходами;
 *  - один источник правды: меняем палитру — меняются все обложки.
 *
 * Что не делаем: не имитируем реальные обложки изданий. Это честная
 * типографическая заглушка: жанр, название, автор, номер тома. Когда
 * появится загруженная обложка, маршрут отдаст её вместо заглушки.
 *
 * Раскладка разбита на зоны (сверху вниз): номер и серия, название,
 * автор, жанр, декор. Текст и декор не пересекаются — это проверено
 * тестом на пересечение зон, а не «на глаз».
 */

const GENRE_PALETTE = {
  'Русская классика': { spine: '#2b5041', paper: '#f4f1ea', ink: '#121314', accent: '#c99a2e' },
  'Зарубежная классика': { spine: '#1d3a52', paper: '#eef1f4', ink: '#121314', accent: '#b98a2b' },
  'Современная проза': { spine: '#6b4a3a', paper: '#f6f0e9', ink: '#1a1512', accent: '#b9762f' },
  Фантастика: { spine: '#20304a', paper: '#e8edf5', ink: '#101725', accent: '#4e7fa6' },
  Фэнтези: { spine: '#3d2a57', paper: '#f0ecf6', ink: '#1a1226', accent: '#8f6bae' },
  Детективы: { spine: '#2a2a2a', paper: '#efeeeb', ink: '#111111', accent: '#a63a30' },
  'Нон-фикшн': { spine: '#37453a', paper: '#f1f2ec', ink: '#14170f', accent: '#6c8c4d' },
  Биографии: { spine: '#4a3b2a', paper: '#f5efe4', ink: '#1c1710', accent: '#a87f45' },
  Поэзия: { spine: '#5a2f42', paper: '#f7eef2', ink: '#1d1015', accent: '#b56a84' },
  'Детская литература': { spine: '#1f5c5a', paper: '#eef6f4', ink: '#0f1f1e', accent: '#c08b28' },
  Психология: { spine: '#3b3a5c', paper: '#f0eff7', ink: '#141328', accent: '#7b76b8' },
  История: { spine: '#5c4a2e', paper: '#f4efe2', ink: '#1b160e', accent: '#9b7a3f' },
  Научпоп: { spine: '#1f4a4a', paper: '#ebf3f3', ink: '#0d1a1a', accent: '#3f9a90' },
  Ужасы: { spine: '#221a1a', paper: '#efeae8', ink: '#120b0b', accent: '#8f2f26' },
  Романтика: { spine: '#6c2f45', paper: '#f9eef1', ink: '#1f0f15', accent: '#c46f80' },
  Антиутопия: { spine: '#2f3335', paper: '#eceff0', ink: '#111415', accent: '#b07c1f' },
  Приключения: { spine: '#2d4a2a', paper: '#f0f4ea', ink: '#131a10', accent: '#8f7a33' },
  Мемуары: { spine: '#45505a', paper: '#f2f3f4', ink: '#141719', accent: '#87929a' },
  Философия: { spine: '#33302a', paper: '#f4f1e9', ink: '#151310', accent: '#a8905c' },
  Бизнес: { spine: '#1c2b3a', paper: '#eef1f4', ink: '#0f161d', accent: '#4f83aa' }
};

const DEFAULT_PALETTE = { spine: '#2b5041', paper: '#f4f1ea', ink: '#121314', accent: '#c99a2e' };

const SIZES = {
  card: { width: 600, height: 900 },
  large: { width: 900, height: 1350 }
};

/**
 * Ширина символа относительно кегля.
 * DejaVu Serif Bold на кириллице шире латиницы: 0.56 давало вылет за поле
 * на длинных названиях, поэтому берём с запасом — «лучше мельче, чем
 * обрезано».
 */
const SERIF_CHAR = 0.66;
const SANS_CHAR = 0.62;

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Устойчивый хэш: одинаковый слаг всегда даёт один и тот же узор. */
function hashOf(value) {
  return crypto.createHash('sha1').update(String(value || '')).digest();
}

/**
 * Разбивает строку на строки не длиннее maxChars.
 *
 * Слова не рвём и не сокращаем: «Преступлен…» вместо названия выглядит
 * как ошибка вёрстки. Если слово длиннее строки, оно занимает свою строку
 * целиком, а кегль подбирает fitTitle — он знает про самое длинное слово.
 */
function wrap(text, maxChars, maxLines = 6) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (!lines.length) return [''];
  return lines.slice(0, maxLines);
}

/**
 * Подбирает кегль под ширину: уменьшаем, пока текст не влезёт
 * в отведённую зону по высоте. Возвращает { size, lines, lineHeight }.
 */
function fitTitle(title, usableWidth, maxHeight, { maxSize, minSize = 14 }) {
  // Кегль не может быть больше, чем позволяет самое длинное слово:
  // иначе оно вылезет за поле и его придётся сокращать
  const longestWord = String(title || '').split(/\s+/).reduce((max, word) => Math.max(max, word.length), 1);
  const wordLimit = Math.floor(usableWidth / (longestWord * SERIF_CHAR));

  let size = Math.max(minSize, Math.min(maxSize, wordLimit));
  let lines = [];
  let lineHeight = 0;

  while (size >= minSize) {
    const chars = Math.max(4, Math.floor(usableWidth / (size * SERIF_CHAR)));
    const candidate = wrap(title, chars, 6);
    const height = candidate.length * Math.round(size * 1.08);
    if (height <= maxHeight) {
      lines = candidate;
      lineHeight = Math.round(size * 1.08);
      break;
    }
    size -= 2;
  }

  if (!lines.length) {
    size = minSize;
    lines = wrap(title, Math.max(4, Math.floor(usableWidth / (size * SERIF_CHAR))), 6);
    lineHeight = Math.round(size * 1.08);
  }

  return { size, lines, lineHeight };
}

function buildCoverSvg({ title, author, genre, slug, series = '', size = 'card' }) {
  const { width, height } = SIZES[size] || SIZES.card;
  const palette = GENRE_PALETTE[genre] || DEFAULT_PALETTE;

  const pad = Math.round(width * 0.09);
  const spineWidth = Math.round(width * 0.05);
  const left = spineWidth + pad;
  const usableWidth = width - left - pad;
  const right = width - pad;

  const digest = hashOf(slug || `${title}-${author}`);
  const variant = digest[0] % 3;
  const numeral = String((digest[1] % 89) + 1).padStart(2, '0');

  // Зоны сверху вниз. Декор занимает нижние 22% и с текстом не пересекается
  const topLabelY = pad + Math.round(width * 0.025);
  const zoneTop = Math.round(height * 0.17);
  const zoneBottom = Math.round(height * 0.60);
  const titleMaxHeight = zoneBottom - zoneTop;
  const titleFit = fitTitle(title, usableWidth, titleMaxHeight, { maxSize: Math.round(width * 0.105) });

  // Короткое название (например, «1984») иначе висит сверху над пустотой:
  // блок центрируем по вертикали в отведённой зоне
  const blockHeight = titleFit.lines.length * titleFit.lineHeight;
  const titleTop = zoneTop + Math.max(0, Math.round((titleMaxHeight - blockHeight) / 2));

  const titleBottom = titleTop + blockHeight;
  const authorY = Math.min(titleBottom + Math.round(width * 0.06), Math.round(height * 0.74));
  const authorLines = wrap(author, Math.max(10, Math.floor(usableWidth / (width * 0.032 * SANS_CHAR))), 2);

  const ruleY = authorY + authorLines.length * Math.round(width * 0.046) + Math.round(width * 0.03);
  const decorTop = Math.round(height * 0.80);

  const titleSvg = titleFit.lines.map((line, index) => (
    `<text x="${left}" y="${titleTop + (index + 1) * titleFit.lineHeight - Math.round(titleFit.size * 0.24)}"
       font-family="DejaVu Serif, Georgia, 'Times New Roman', serif"
       font-size="${titleFit.size}" font-weight="700" fill="${palette.ink}"
       letter-spacing="-0.5">${escapeXml(line)}</text>`
  )).join('');

  const authorSvg = authorLines.map((line, index) => (
    `<text x="${left}" y="${authorY + index * Math.round(width * 0.046)}"
       font-family="DejaVu Sans, Helvetica, Arial, sans-serif"
       font-size="${Math.round(width * 0.032)}" fill="${palette.ink}" opacity="0.66"
       letter-spacing="1.6">${escapeXml(line.toUpperCase())}</text>`
  )).join('');

  // Декор: три варианта, чтобы полка не выглядела штампованной
  const decor = [
    `<circle cx="${right - Math.round(width * 0.05)}" cy="${decorTop + Math.round(width * 0.10)}" r="${Math.round(width * 0.20)}" fill="none" stroke="${palette.accent}" stroke-width="${Math.round(width * 0.008)}" opacity="0.5"/>
     <circle cx="${right - Math.round(width * 0.05)}" cy="${decorTop + Math.round(width * 0.10)}" r="${Math.round(width * 0.11)}" fill="${palette.accent}" opacity="0.14"/>`,
    `<path d="M ${left} ${decorTop} L ${right} ${decorTop}" stroke="${palette.accent}" stroke-width="${Math.round(width * 0.006)}" opacity="0.55"/>
     <path d="M ${left} ${decorTop + Math.round(width * 0.06)} L ${right - Math.round(width * 0.16)} ${decorTop + Math.round(width * 0.06)}" stroke="${palette.accent}" stroke-width="${Math.round(width * 0.003)}" opacity="0.35"/>
     <rect x="${left}" y="${decorTop + Math.round(width * 0.12)}" width="${Math.round(width * 0.16)}" height="${Math.round(width * 0.16)}" fill="none" stroke="${palette.accent}" stroke-width="${Math.round(width * 0.006)}" opacity="0.45"/>`,
    `<rect x="${right - Math.round(width * 0.24)}" y="${decorTop + Math.round(width * 0.02)}" width="${Math.round(width * 0.24)}" height="${Math.round(width * 0.24)}" fill="${palette.accent}" opacity="0.13"/>
     <circle cx="${left + Math.round(width * 0.03)}" cy="${decorTop + Math.round(width * 0.09)}" r="${Math.round(width * 0.045)}" fill="none" stroke="${palette.accent}" stroke-width="${Math.round(width * 0.006)}" opacity="0.5"/>`
  ][variant];

  const genreLabel = String(genre || '').toUpperCase();
  // Крупная «призрачная» литера: заполняет пустоту у коротких названий
  // и остаётся в той же типографике — никаких картинок
  const ghost = String(title || '').trim().charAt(0).toUpperCase();
  const ghostY = Math.round(height * 0.88);
  const ghostSize = Math.round(width * 0.38);
  const ghostOpacity = blockHeight < titleMaxHeight * 0.6 ? 0.055 : 0.03;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(`Обложка: ${title}`)}">
  <rect width="${width}" height="${height}" fill="${palette.paper}"/>
  <rect x="0" y="0" width="${spineWidth}" height="${height}" fill="${palette.spine}"/>
  <rect x="${spineWidth}" y="0" width="${Math.round(width * 0.006)}" height="${height}" fill="${palette.accent}" opacity="0.55"/>
  <text x="${pad}" y="${topLabelY}" font-family="DejaVu Sans, Helvetica, Arial, sans-serif"
        font-size="${Math.round(width * 0.022)}" fill="${palette.ink}" opacity="0.45" letter-spacing="2.4">${escapeXml(series || 'КНИГОМАНЫ')}</text>
  <text x="${right}" y="${topLabelY}" text-anchor="end" font-family="DejaVu Sans, Helvetica, Arial, sans-serif"
        font-size="${Math.round(width * 0.028)}" fill="${palette.ink}" opacity="0.4" letter-spacing="1.6">${numeral}</text>
  <rect x="${left}" y="${Math.round(height * 0.13)}" width="${Math.round(width * 0.08)}" height="3" fill="${palette.accent}"/>
  <text x="${right}" y="${ghostY}" text-anchor="end" font-family="DejaVu Serif, Georgia, serif"
        font-size="${ghostSize}" font-weight="700" fill="${palette.ink}" opacity="${ghostOpacity}">${escapeXml(ghost)}</text>
  ${titleSvg}
  ${authorSvg}
  <rect x="${left}" y="${ruleY}" width="${Math.round(width * 0.12)}" height="2" fill="${palette.accent}" opacity="0.7"/>
  <text x="${left}" y="${ruleY + Math.round(width * 0.045)}" font-family="DejaVu Sans, Helvetica, Arial, sans-serif"
        font-size="${Math.round(width * 0.02)}" fill="${palette.ink}" opacity="0.42" letter-spacing="2">${escapeXml(genreLabel)}</text>
  ${decor}
</svg>`;
}

module.exports = {
  buildCoverSvg,
  wrap,
  fitTitle,
  GENRE_PALETTE,
  DEFAULT_PALETTE,
  SIZES,
  escapeXml
};
