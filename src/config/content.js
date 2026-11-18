'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Контент, который наполняется руками: книги, подборки, авторы.
 *
 * Лежит в JSON, а не в коде и не в миграциях: наполнение — это данные,
 * их правят без деплоя. Один и тот же файл читает и сид для разработки,
 * и библиотека наполнения для продакшена, поэтому «на демо 60 книг, на проде
 * 12» больше не случится.
 *
 * Формат описан в docs/CONTENT.md. Проверки формата — в src/lib/content.js,
 * они же используются тестами: битый JSON не должен доехать до продакшена.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_DIR = path.join(ROOT, 'content');

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/** Путь к папке контента: CONTENT_DIR позволяет держать его вне репозитория. */
function contentDir(env = process.env) {
  return env.CONTENT_DIR ? path.resolve(env.CONTENT_DIR) : DEFAULT_DIR;
}

/**
 * Загружает весь контент разом.
 * Отсутствующий файл — это не ошибка: на чистой установке подборок может
 * ещё не быть. Битый JSON — ошибка: молча работать с половиной каталога хуже.
 */
function loadContent({ dir = contentDir(), required = [] } = {}) {
  const files = {
    books: 'books.json',
    collections: 'collections.json',
    authors: 'authors.json',
    clubs: 'clubs.json'
  };

  const content = {};
  Object.entries(files).forEach(([key, name]) => {
    const filePath = path.join(dir, name);
    try {
      content[key] = readJson(filePath);
    } catch (error) {
      throw new Error(`${name}: битый JSON — ${error.message}`);
    }
    if (content[key] === null && required.includes(key)) {
      throw new Error(`не найден обязательный файл контента: ${filePath}`);
    }
  });

  return {
    dir,
    books: content.books || [],
    collections: content.collections || [],
    authors: content.authors || [],
    clubs: content.clubs || []
  };
}

module.exports = { contentDir, loadContent, DEFAULT_DIR, ROOT };
