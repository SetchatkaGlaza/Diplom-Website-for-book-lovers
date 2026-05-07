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

module.exports = {
  DEFAULT_PREVIEW_LENGTH,
  truncateText
};
