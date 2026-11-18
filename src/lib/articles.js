'use strict';

const { slugify } = require('./slug');

/**
 * Проверка статей «Журнала».
 *
 * Статья — это не запись в базе, а текст, который лежит в файле и отдаётся
 * как HTML. Поэтому единственная защита от опечатки — проверка перед публикацией.
 * Что проверяем и почему:
 *  - слаг: адрес статьи, он же ключ для связей. Два одинаковых слага —
 *    один текст затрёт другой при поиске;
 *  - заголовок 10–120 знаков: короче — не о чём, длиннее — не влезает в <title>;
 *  - description ≤ 200: это то, что видно в поисковой выдаче;
 *  - минимум две секции: статья из одного абзаца — это не статья;
 *  - секция без заголовка или без абзацев — почти всегда забытый кусок.
 */

const TOPICS = ['Практика', 'Подборки', 'Клубы'];

const LIMITS = {
  titleMin: 10,
  titleMax: 120,
  descriptionMin: 40,
  descriptionMax: 200,
  slugMin: 5,
  slugMax: 80,
  sectionsMin: 2,
  sectionsMax: 12,
  headingMin: 4,
  headingMax: 120,
  paragraphMin: 40,
  paragraphMax: 1500,
  paragraphsMax: 12,
  readingMinutesMax: 40,
  articlesMax: 200,
  // Статья не должна превращаться в пересказ книги: 4000 слов — это уже глава
  wordsMax: 2500
};

function isFilled(value, min = 1) {
  return typeof value === 'string' && value.trim().length >= min;
}

function countWords(article) {
  return article.sections.reduce(
    (total, section) => total + section.paragraphs.join(' ').split(/\s+/).filter(Boolean).length,
    0
  );
}

/**
 * Проверяет массив статей.
 * Возвращает { errors, warnings, articles } — articles уже нормализованы:
 * слаг, обрезанные строки, число минут, дата в ISO.
 */
function validateArticles(raw, { topics = TOPICS } = {}) {
  const errors = [];
  const warnings = [];
  const articles = [];
  const seen = new Map();
  const knownTopics = new Set(topics);

  if (!Array.isArray(raw)) {
    return { errors: ['articles.json: ожидался массив статей'], warnings, articles };
  }

  if (raw.length > LIMITS.articlesMax) {
    warnings.push(`статей больше ${LIMITS.articlesMax}: список журнала станет длинным`);
  }

  raw.forEach((item, index) => {
    const errorsBefore = errors.length;
    const where = `статья №${index + 1}${isFilled(item && item.title) ? ` («${item.title}»)` : ''}`;

    if (!item || typeof item !== 'object') {
      errors.push(`${where}: ожидался объект`);
      return;
    }

    const slug = String(item.slug || '').trim() || slugify(item.title || '');
    const title = String(item.title || '').trim();
    const description = String(item.description || '').trim();
    const topic = String(item.topic || '').trim();

    if (slug.length < LIMITS.slugMin) errors.push(`${where}: адрес короче ${LIMITS.slugMin} символов`);
    if (slug.length > LIMITS.slugMax) errors.push(`${where}: адрес длиннее ${LIMITS.slugMax} символов`);
    if (!/^[a-z0-9-]+$/.test(slug)) errors.push(`${where}: адрес «${slug}» — только латиница, цифры и дефис`);
    if (seen.has(slug)) errors.push(`${where}: адрес «${slug}» уже занят статьёй №${seen.get(slug)}`);

    if (title.length < LIMITS.titleMin) errors.push(`${where}: заголовок короче ${LIMITS.titleMin} символов`);
    if (title.length > LIMITS.titleMax) errors.push(`${where}: заголовок длиннее ${LIMITS.titleMax} символов`);

    if (description.length < LIMITS.descriptionMin) {
      errors.push(`${where}: описание короче ${LIMITS.descriptionMin} символов`);
    }
    if (description.length > LIMITS.descriptionMax) {
      errors.push(`${where}: описание длиннее ${LIMITS.descriptionMax} символов — поисковик обрежет`);
    }

    if (!topic) {
      errors.push(`${where}: не указана тема`);
    } else if (!knownTopics.has(topic)) {
      errors.push(`${where}: неизвестная тема «${topic}» (допустимы: ${topics.join(', ')})`);
    }

    const rawSections = Array.isArray(item.sections) ? item.sections : [];
    if (rawSections.length < LIMITS.sectionsMin) {
      errors.push(`${where}: секций меньше ${LIMITS.sectionsMin}`);
    }
    if (rawSections.length > LIMITS.sectionsMax) {
      errors.push(`${where}: секций больше ${LIMITS.sectionsMax} — статью пора делить`);
    }

    const sections = [];
    rawSections.forEach((section, sectionIndex) => {
      const at = `${where}, секция №${sectionIndex + 1}`;
      if (!section || typeof section !== 'object') {
        errors.push(`${at}: ожидался объект`);
        return;
      }

      const heading = String(section.heading || '').trim();
      const paragraphs = (Array.isArray(section.paragraphs) ? section.paragraphs : [])
        .map((paragraph) => String(paragraph || '').trim())
        .filter(Boolean);

      if (heading.length < LIMITS.headingMin) errors.push(`${at}: заголовок короче ${LIMITS.headingMin} символов`);
      if (heading.length > LIMITS.headingMax) errors.push(`${at}: заголовок длиннее ${LIMITS.headingMax} символов`);
      if (!paragraphs.length) errors.push(`${at}: нет ни одного абзаца`);
      if (paragraphs.length > LIMITS.paragraphsMax) {
        warnings.push(`${at}: ${paragraphs.length} абзацев — секция читается тяжело`);
      }
      paragraphs.forEach((paragraph, paragraphIndex) => {
        if (paragraph.length < LIMITS.paragraphMin) {
          errors.push(`${at}, абзац ${paragraphIndex + 1}: короче ${LIMITS.paragraphMin} символов`);
        }
        if (paragraph.length > LIMITS.paragraphMax) {
          errors.push(`${at}, абзац ${paragraphIndex + 1}: длиннее ${LIMITS.paragraphMax} символов — разбейте`);
        }
      });

      sections.push({ heading, paragraphs });
    });

    const minutes = Number(item.readingMinutes);
    if (item.readingMinutes !== undefined
      && (!Number.isInteger(minutes) || minutes < 1 || minutes > LIMITS.readingMinutesMax)) {
      errors.push(`${where}: время чтения — целое число минут от 1 до ${LIMITS.readingMinutesMax}`);
    }

    const datePublished = String(item.datePublished || '').trim();
    if (datePublished && !/^\d{4}-\d{2}-\d{2}$/.test(datePublished)) {
      errors.push(`${where}: дата публикации в формате ГГГГ-ММ-ДД`);
    }
    if (!datePublished) warnings.push(`${where}: нет даты публикации — в разметке Article она необязательна, но полезна`);

    const article = {
      slug,
      title,
      description,
      topic,
      readingMinutes: Number.isInteger(minutes) && minutes > 0 ? minutes : estimateMinutes(sections),
      sections,
      datePublished: datePublished || null
    };

    const words = countWords(article);
    if (words > LIMITS.wordsMax) {
      errors.push(`${where}: ${words} слов — слишком много для журнальной статьи`);
    } else if (words < 200) {
      warnings.push(`${where}: всего ${words} слов — поисковики сочтут текст тонким`);
    }

    seen.set(slug, index + 1);
    // Статью с ошибками не показываем: половина текста на сайте выглядит
    // как «сайт сломан», а не как «в редакции опечатка»
    if (errors.length === errorsBefore) articles.push({ ...article, words });
  });

  return { errors, warnings, articles };
}

/** Время чтения по объёму: 180 слов в минуту — средний темп для русского текста. */
function estimateMinutes(sections) {
  const words = sections.reduce((total, section) => total + section.paragraphs.join(' ').split(/\s+/).length, 0);
  return Math.max(1, Math.round(words / 180));
}

module.exports = { LIMITS, TOPICS, validateArticles, estimateMinutes };
