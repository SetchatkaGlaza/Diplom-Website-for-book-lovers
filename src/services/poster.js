'use strict';

const sharp = require('sharp');

/**
 * Карточка «Книжный год» для соцсетей.
 *
 * Собираем SVG-строку и отдаём sharp — он превращает её в настоящий PNG.
 * Так текст с кириллицей выглядит нормально (без ручного шрифта из точек),
 * а размеры держим ровно под соцсети: 1080×1350 для сторис и 1080×1080 для ленты.
 *
 * Ограничения по безопасности: всё, что приходит от пользователя (имя),
 * экранируется — иначе в SVG можно вставить свой тег.
 */

const SIZES = {
  story: { width: 1080, height: 1350 },
  square: { width: 1080, height: 1080 }
};

const COLORS = {
  ink: '#121314',
  paper: '#fbfaf7',
  amber: '#f5b935',
  green: '#2b5041',
  muted: '#6b655c',
  line: '#e6e1d7',
  card: '#1d1e20'
};

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Обрезает длинный текст с многоточием, чтобы он не вылезал за карточку. */
function cut(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function pluralBooks(count) {
  const value = Number(count) || 0;
  const tail = value % 100;
  if (tail >= 11 && tail <= 14) return 'книг';
  if (value % 10 === 1) return 'книга';
  if (value % 10 >= 2 && value % 10 <= 4) return 'книги';
  return 'книг';
}

function buildSvg(data, size) {
  const { width, height } = SIZES[size] || SIZES.story;
  const pad = 76;
  const year = Number(data.year) || new Date().getFullYear();
  const name = cut(String(data.name || 'Читатель').toUpperCase(), 24);
  const genres = (data.genres || []).slice(0, 3);
  const isStory = size !== 'square';

  const boxes = [
    { value: String(data.books ?? 0), label: pluralBooks(data.books), accent: COLORS.green },
    { value: String(data.pages ?? 0), label: 'страниц', accent: COLORS.green },
    { value: String(data.reviews ?? 0), label: 'рецензий', accent: COLORS.green },
    { value: String(data.streak ?? 0), label: 'дней подряд', accent: COLORS.amber }
  ];

  const boxTop = 320;
  const boxHeight = isStory ? 236 : 170;
  const gap = 24;
  const boxWidth = (width - pad * 2 - gap) / 2;

  const boxesSvg = boxes.map((box, index) => {
    const x = pad + (index % 2) * (boxWidth + gap);
    const y = boxTop + Math.floor(index / 2) * (boxHeight + gap);
    const valueSize = isStory ? 96 : 76;
    return `
      <g>
        <rect x="${x}" y="${y}" width="${boxWidth}" height="${boxHeight}" rx="18" fill="${COLORS.card}"/>
        <rect x="${x}" y="${y}" width="9" height="${boxHeight}" rx="4" fill="${box.accent}"/>
        <text x="${x + 34}" y="${y + 40 + valueSize}" font-family="'DejaVu Sans', Arial, sans-serif"
              font-size="${valueSize}" font-weight="700" fill="${COLORS.paper}">${escapeXml(box.value)}</text>
        <text x="${x + 34}" y="${y + boxHeight - 28}" font-family="'DejaVu Sans', Arial, sans-serif"
              font-size="24" fill="${COLORS.muted}">${escapeXml(box.label)}</text>
      </g>`;
  }).join('');

  const genresTitleY = boxTop + boxHeight * 2 + gap + 84;
  let genreTop = genresTitleY + 56;
  const maxGenreWidth = width - pad * 2 - 160;
  const genreSvg = genres.length
    ? genres.map((genre, index) => {
      const share = Number(genre.count) / (Number(genres[0].count) || 1);
      const barWidth = Math.max(48, Math.round(maxGenreWidth * share));
      const line = `
        <g>
          <text x="${pad}" y="${genreTop}" font-family="'DejaVu Sans', Arial, sans-serif"
                font-size="22" fill="${COLORS.paper}">${escapeXml(cut(genre.name, 22))}</text>
          <rect x="${pad}" y="${genreTop + 14}" width="${barWidth}" height="12" rx="6"
                fill="${index === 0 ? COLORS.amber : COLORS.green}"/>
          <text x="${pad + barWidth + 16}" y="${genreTop + 26}" font-family="'DejaVu Sans', Arial, sans-serif"
                font-size="20" fill="${COLORS.muted}">${escapeXml(genre.count)}</text>
        </g>`;
      genreTop += 62;
      return line;
    }).join('')
    : `<text x="${pad}" y="${genreTop}" font-family="'DejaVu Sans', Arial, sans-serif"
             font-size="22" fill="${COLORS.muted}">Пока нет данных за этот год</text>`;

  const footerY = height - 74;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="${COLORS.ink}"/>
    <rect width="${width}" height="196" fill="${COLORS.green}"/>

    <text x="${pad}" y="66" font-family="'DejaVu Sans', Arial, sans-serif" font-size="20"
          letter-spacing="6" fill="${COLORS.amber}">КНИГОМАНЫ</text>
    <text x="${pad}" y="140" font-family="'DejaVu Sans', Arial, sans-serif" font-size="64"
          font-weight="700" fill="${COLORS.paper}">Книжный год</text>
    <text x="${width - pad}" y="140" text-anchor="end" font-family="'DejaVu Sans', Arial, sans-serif"
          font-size="64" font-weight="700" fill="${COLORS.amber}">${year}</text>

    <text x="${pad}" y="252" font-family="'DejaVu Sans', Arial, sans-serif" font-size="26"
          letter-spacing="2" fill="${COLORS.muted}">${escapeXml(name)}</text>

    ${boxesSvg}

    <text x="${pad}" y="${genresTitleY}" font-family="'DejaVu Sans', Arial, sans-serif"
          font-size="20" letter-spacing="4" fill="${COLORS.amber}">ЛЮБИМЫЕ ЖАНРЫ</text>
    ${genreSvg}

    <rect x="${pad}" y="${footerY - 34}" width="${width - pad * 2}" height="1" fill="${COLORS.line}" opacity="0.35"/>
    <text x="${pad}" y="${footerY}" font-family="'DejaVu Sans', Arial, sans-serif" font-size="20"
          fill="${COLORS.muted}">книгоманы.ру · дневник чтения</text>
  </svg>`;
}

/**
 * Возвращает { buffer, width, height } — готовый PNG.
 * Если sharp недоступен (например, на хостинге без бинарников), кидаем понятную ошибку.
 */
async function renderYearCard(data, { size = 'story' } = {}) {
  const resolved = SIZES[size] ? size : 'story';
  const svg = buildSvg(data, resolved);

  // density 72 — ровно один пиксель SVG на пиксель картинки (иначе sharp удвоит)
  const buffer = await sharp(Buffer.from(svg, 'utf8'), { density: 72 })
    .resize(SIZES[resolved].width, SIZES[resolved].height, { fit: 'fill' })
    .png({ compressionLevel: 9 })
    .toBuffer();

  return { buffer, ...SIZES[resolved], size: resolved };
}

module.exports = { renderYearCard, buildSvg, SIZES, pluralBooks, escapeXml };
