'use strict';

/**
 * «Журнал»: раздел статей.
 *
 * Что здесь важно проверить:
 *  - статьи в репозитории валидны (слаги уникальны, описания влезают в выдачу,
 *    у каждой статьи есть хотя бы две секции) — битый текст не должен
 *    доехать до продакшена;
 *  - список и статья открываются гостю, неизвестный слаг — 404, а не 500;
 *  - в статье есть разметка Article и BreadcrumbList, иначе поисковик
 *    увидит обычную страницу без автора и даты;
 *  - sitemap содержит статьи, а «читайте также» не ссылается на себя.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const request = require('supertest');

const { createTestApp } = require('../support/app');
const { loadArticles } = require('../../src/config/articles');
const { validateArticles, LIMITS, TOPICS } = require('../../src/lib/articles');
const { createArticleService } = require('../../src/services/articles');

const CONTENT_DIR = path.join(__dirname, '..', '..', 'content');
const journal = createArticleService({ articles: loadArticles({ dir: CONTENT_DIR }).articles });
const FIRST = journal.all()[0];

test('статьи в репозитории валидны и их достаточно для раздела', () => {
  const result = validateArticles(loadArticles({ dir: CONTENT_DIR }).articles);

  assert.deepEqual(result.errors, [], `ошибки статей:\n${result.errors.join('\n')}`);
  assert.ok(result.articles.length >= 30, `статей должно быть 30+, а не ${result.articles.length}`);

  // Каждая тема должна быть наполнена, иначе пустая кнопка фильтра
  TOPICS.forEach((topic) => {
    const count = result.articles.filter((article) => article.topic === topic).length;
    assert.ok(count >= 2, `в теме «${topic}» всего ${count} статьи`);
  });

  result.articles.forEach((article) => {
    assert.ok(article.words >= 150, `«${article.title}»: всего ${article.words} слов`);
    assert.ok(article.words <= LIMITS.wordsMax, `«${article.title}»: ${article.words} слов — это уже глава`);
    assert.match(article.datePublished, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(article.readingMinutes >= 1);
  });

  // Тексты не повторяют друг друга: сравнение первых абзацев — дешёвая проверка на копипаст
  const openings = new Set();
  result.articles.forEach((article) => {
    const opening = article.sections[0].paragraphs[0].slice(0, 60);
    assert.ok(!openings.has(opening), `«${article.title}»: первый абзац совпадает с другой статьёй`);
    openings.add(opening);
  });

  assert.deepEqual(journal.errors, []);
  assert.equal(journal.isReady, true);
});

test('валидатор статей ловит типичные опечатки', () => {
  const base = {
    slug: 'test-article',
    title: 'Тестовая статья о чтении',
    description: 'Короткое, но достаточное описание статьи для проверки валидатора.',
    topic: 'Практика',
    readingMinutes: 3,
    sections: [
      { heading: 'Первый раздел', paragraphs: ['Достаточно длинный абзац, чтобы пройти проверку на минимальную длину текста.'] },
      { heading: 'Второй раздел', paragraphs: ['Ещё один абзац такой же длины, чтобы статья считалась настоящей.'] }
    ]
  };

  assert.deepEqual(validateArticles([base]).errors, []);

  const duplicated = validateArticles([base, { ...base }]);
  assert.ok(duplicated.errors.some((error) => error.includes('уже занят')));

  const badTopic = validateArticles([{ ...base, topic: 'Стихи' }]);
  assert.ok(badTopic.errors.some((error) => error.includes('неизвестная тема')));

  const oneSection = validateArticles([{ ...base, sections: [base.sections[0]] }]);
  assert.ok(oneSection.errors.some((error) => error.includes('секций меньше')));

  const emptyParagraphs = validateArticles([{
    ...base,
    sections: [base.sections[0], { heading: 'Пустой раздел', paragraphs: [] }]
  }]);
  assert.ok(emptyParagraphs.errors.some((error) => error.includes('нет ни одного абзаца')));

  const longDescription = validateArticles([{ ...base, description: 'а'.repeat(LIMITS.descriptionMax + 1) }]);
  assert.ok(longDescription.errors.some((error) => error.includes('описание длиннее')));

  const badSlug = validateArticles([{ ...base, slug: 'Статья По-русски' }]);
  assert.ok(badSlug.errors.some((error) => error.includes('только латиница')));
});

test('служебные функции сервиса: темы, похожие статьи, статистика', () => {
  const total = journal.stats().count;
  assert.equal(journal.all().length, total);
  assert.ok(journal.stats().words > 5000, `в журнале всего ${journal.stats().words} слов`);

  const topics = journal.topics();
  assert.equal(topics.reduce((sum, topic) => sum + topic.count, 0), total);

  const related = journal.related(FIRST.slug, 3);
  assert.equal(related.length, 3);
  assert.ok(related.every((item) => item.slug !== FIRST.slug), 'похожая статья ссылается на саму себя');
  // Первыми идут статьи той же темы: читателю логичнее остаться в теме
  assert.equal(related[0].topic, FIRST.topic);

  assert.equal(journal.one('no-such-article'), null);
  assert.deepEqual(journal.related('no-such-article'), []);
});

test('список журнала открывается гостю и группирует статьи по темам', async () => {
  const { app } = await createTestApp();
  const res = await request(app).get('/zhurnal').expect(200);

  assert.match(res.text, /Журнал/);
  assert.match(res.text, /href="\/zhurnal\//);
  // Счётчик в шапке раздела: гостю должно быть понятно, что тут есть что читать
  assert.match(res.text, new RegExp(`${journal.stats().count} (статья|статьи|статей)`));

  // Фильтр по теме отдаёт только эту тему
  const topic = journal.topics()[0].name;
  const filtered = await request(app).get(`/zhurnal?tema=${encodeURIComponent(topic)}`).expect(200);
  const otherTopicArticle = journal.all().find((article) => article.topic !== topic);
  assert.ok(!filtered.text.includes(`/zhurnal/${otherTopicArticle.slug}"`));

  // Несуществующая тема — просто полный список, без 404: ссылка могла устареть
  await request(app).get('/zhurnal?tema=несуществующая').expect(200);
});

test('страница статьи отдаёт текст, разметку Article и навигацию', async () => {
  const { app } = await createTestApp();
  const res = await request(app).get(`/zhurnal/${FIRST.slug}`).expect(200);

  assert.match(res.text, new RegExp(FIRST.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(res.text, /application\/ld\+json/);
  assert.match(res.text, /"@type":"Article"/);
  assert.match(res.text, /"@type":"BreadcrumbList"/);
  assert.match(res.text, /"headline"/);
  // Каждая секция видна на странице
  FIRST.sections.forEach((section) => {
    assert.ok(res.text.includes(section.heading), `нет секции «${section.heading}»`);
  });
  // Текст, а не заглушка: первый абзац должен быть в HTML
  assert.ok(res.text.includes(FIRST.sections[0].paragraphs[0].slice(0, 40)));
  // Призыв идёт после статьи и ведёт в дневник, а не в магазин
  assert.match(res.text, /href="\/registratsiya"/);
  assert.match(res.text, /Читайте также/);
  // canonical ведёт на саму статью
  assert.match(res.text, new RegExp(`rel="canonical" href="[^"]*/zhurnal/${FIRST.slug}"`));
});

test('неизвестная статья и мусорный адрес дают 404, а не 500', async () => {
  const { app } = await createTestApp();
  await request(app).get('/zhurnal/no-such-article').expect(404);
  await request(app).get('/zhurnal/СТАТЬЯ').expect(404);
  await request(app).get('/zhurnal/%D1%81%D1%82%D0%B0%D1%82%D1%8C%D1%8F').expect(404);
});

test('sitemap содержит журнал и каждую статью', async () => {
  const { app } = await createTestApp();
  const res = await request(app).get('/sitemap.xml').expect(200);

  assert.match(res.text, /\/zhurnal<\/loc>/);
  journal.all().forEach((article) => {
    assert.ok(res.text.includes(`/zhurnal/${article.slug}</loc>`), `в sitemap нет ${article.slug}`);
  });
  // Даты статей попадают в lastmod — поисковик понимает, что список живой
  assert.match(res.text, new RegExp(`/zhurnal/${FIRST.slug}</loc>\\s*<lastmod>\\d{4}-\\d{2}-\\d{2}</lastmod>`));
});

test('ссылка на журнал есть в шапке и в подвале', async () => {
  const { app } = await createTestApp();
  const res = await request(app).get('/').expect(200);

  const header = res.text.slice(0, res.text.indexOf('</header>'));
  assert.match(header, /href="\/zhurnal"/);
  const footer = res.text.slice(res.text.indexOf('<footer'));
  assert.match(footer, /href="\/zhurnal"/);
});

test('битый articles.json не роняет сайт: журнал закрывается, каталог работает', async () => {
  const { createArticleService: createEmpty } = require('../../src/services/articles');
  const broken = createEmpty({
    articles: [{ slug: 'x', title: 'Коротко', description: 'нет', topic: 'Нет', sections: [] }]
  });

  assert.equal(broken.isReady, false);
  assert.ok(broken.errors.length > 0);
  // Даже в нерабочем состоянии сервис отвечает, а не бросает
  assert.deepEqual(broken.all(), []);
  assert.equal(broken.one('x'), null);
});

test('шапка помечает текущий раздел валидным aria-current', async () => {
  const { app } = await createTestApp();
  const res = await request(app).get('/zhurnal').expect(200);

  // EJS экранирует кавычки в <%= %>, и в браузер уезжало aria-current=&#34;page&#34;
  assert.match(res.text, /<a href="\/zhurnal" aria-current="page">Журнал<\/a>/);
  assert.ok(!res.text.includes('aria-current=&#34;page&#34;'), 'кавычки в aria-current экранированы');
});
