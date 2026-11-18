'use strict';

const MAP = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya'
};

function transliterate(input = '') {
  return String(input)
    .toLowerCase()
    .split('')
    .map((char) => (Object.prototype.hasOwnProperty.call(MAP, char) ? MAP[char] : char))
    .join('');
}

function slugify(input = '', fallback = 'item') {
  const slug = transliterate(input)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

/**
 * Уникальный слаг: базовый + короткий суффикс, если такой уже занят.
 * existsFn(slug) -> Promise<boolean>
 */
async function uniqueSlug(input, existsFn, fallback = 'kniga') {
  const base = slugify(input, fallback);
  if (!(await existsFn(base))) return base;
  // Детерминированные суффиксы: ten-gory-2, ten-gory-3, ... — удобно для ссылок
  for (let i = 2; i <= 500; i += 1) {
    const candidate = `${base}-${i}`;
    if (!(await existsFn(candidate))) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

module.exports = { slugify, uniqueSlug, transliterate };
