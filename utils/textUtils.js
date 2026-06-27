const DEFAULT_PREVIEW_LENGTH = 240;

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncateText(value, maxLength = DEFAULT_PREVIEW_LENGTH) {
  const text = normalizeText(value);
  const limit = Number.isFinite(Number(maxLength)) ? Number(maxLength) : DEFAULT_PREVIEW_LENGTH;

  if (text.length <= limit) {
    return { text, isTruncated: false, fullText: text };
  }

  const slice = text.slice(0, limit + 1);
  const lastSpaceIndex = slice.lastIndexOf(' ');
  const safeEnd = lastSpaceIndex > Math.floor(limit * 0.65) ? lastSpaceIndex : limit;

  return {
    text: `${text.slice(0, safeEnd).trim()}…`,
    isTruncated: true,
    fullText: text
  };
}

function pluralizeRu(number, forms) {
  const value = Math.abs(Number(number) || 0);
  const mod100 = value % 100;
  const mod10 = value % 10;

  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

function formatRuCount(number, forms) {
  return `${Number(number) || 0} ${pluralizeRu(number, forms)}`;
}

module.exports = {
  DEFAULT_PREVIEW_LENGTH,
  truncateText,
  pluralizeRu,
  formatRuCount
};
