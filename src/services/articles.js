'use strict';

const { loadArticles } = require('../config/articles');
const { validateArticles, TOPICS } = require('../lib/articles');

/**
 * Сервис «Журнала».
 *
 * Статьи не лежат в базе: это редактируемый контент, он меняется вместе с
 * выкладкой, а не с действиями читателей. Поэтому сервис — тонкая обёртка
 * над одним загруженным массивом с поиском по слагу.
 *
 * Валидация запускается при создании: если в articles.json опечатка,
 * сайт поднимется, но журнал будет помечен как «не готов» и не покажет
 * битые тексты. Это лучше, чем 500 на каждой странице раздела.
 */
function createArticleService({ articles: raw = [], check = true } = {}) {
  const result = check ? validateArticles(raw) : { errors: [], warnings: [], articles: raw };
  const list = result.articles
    .slice()
    .sort((a, b) => String(b.datePublished || '').localeCompare(String(a.datePublished || '')));
  const bySlug = new Map(list.map((article) => [article.slug, article]));

  /** Все статьи, свежие сверху. Опционально — только одна тема. */
  function all({ topic = null } = {}) {
    if (!topic) return list.slice();
    return list.filter((article) => article.topic === topic);
  }

  /** Статья по адресу или null: 404 решает маршрут, а не сервис. */
  function one(slug) {
    return bySlug.get(String(slug || '')) || null;
  }

  /** Темы с количеством: нужны для навигации по журналу. */
  function topics() {
    return TOPICS
      .map((name) => ({ name, count: list.filter((article) => article.topic === name).length }))
      .filter((topic) => topic.count > 0);
  }

  /**
   * Похожие статьи: сначала та же тема, потом — остальные.
   * Себя из выдачи исключаем всегда: ссылка «читайте также» на текущую
   * страницу выглядит как ошибка вёрстки.
   */
  function related(slug, limit = 3) {
    const current = one(slug);
    if (!current) return [];
    const sameTopic = list.filter((item) => item.slug !== current.slug && item.topic === current.topic);
    const otherTopic = list.filter((item) => item.slug !== current.slug && item.topic !== current.topic);
    return [...sameTopic, ...otherTopic].slice(0, Math.max(0, limit));
  }

  /** Общая длина журнала в словах: показываем на странице раздела. */
  function stats() {
    const words = list.reduce((total, article) => total + (article.words || 0), 0);
    return { count: list.length, words, topics: topics().length };
  }

  return {
    all,
    one,
    topics,
    related,
    stats,
    errors: result.errors,
    warnings: result.warnings,
    isReady: result.errors.length === 0
  };
}

/** Сборка сервиса из файла: используется в app.js и в тестах. */
function buildArticleService(options = {}) {
  const { articles } = loadArticles(options);
  return createArticleService({ articles, ...options });
}

module.exports = { createArticleService, buildArticleService };
