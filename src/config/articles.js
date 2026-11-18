'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { contentDir } = require('./content');

/**
 * Статьи «Журнала».
 *
 * Отдельный файл, а не общий content.json: статьи живут дольше каталога и
 * правятся отдельно — редактору не нужно трогать 345 книг, чтобы добавить
 * текст. Читаем один раз при старте и держим в памяти: статей десятки,
 * они не меняются в течение дня, а лишний запрос к диску на каждый показ
 * ни к чему.
 *
 * Битый JSON — ошибка: лучше упасть на старте, чем отдавать полжурнала.
 * Отсутствующий файл — не ошибка: раздел просто будет пустым, сайт работает.
 */
function loadArticles({ dir = contentDir() } = {}) {
  const filePath = path.join(dir, 'articles.json');
  if (!fs.existsSync(filePath)) return { dir, articles: [], filePath };

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error('ожидался массив статей');
    return { dir, articles: parsed, filePath };
  } catch (error) {
    throw new Error(`articles.json: битый JSON — ${error.message}`);
  }
}

module.exports = { loadArticles };
