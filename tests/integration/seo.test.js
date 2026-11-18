'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createTestApp, extractCsrf } = require('../support/app');

/**
 * SEO и доступность.
 *
 * Критерии плана:
 *  - у всех публичных страниц есть title, description и canonical;
 *  - нет битых внутренних ссылок;
 *  - у картинок есть alt;
 *  - sitemap и robots отдают валидный текст.
 */

const PUBLIC_PAGES = ['/', '/knigi', '/kluby', '/pravila', '/soglashenie', '/konfidentsialnost', '/pravoobladatelyam'];

async function signIn(ctx, email, name) {
  const user = await ctx.createUser({ email, name });
  const agent = request.agent(ctx.app);
  await ctx.login(user, 'reader2026', agent);
  return { user, agent };
}

test('у публичных страниц есть title, description, canonical и og', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  await ctx.models.Book.create({
    slug: 'duna', title: 'Дюна', author: 'Фрэнк Герберт', pages: 600, isPublished: true
  });

  for (const path of [...PUBLIC_PAGES, '/knigi/duna']) {
    const response = await ctx.request.get(path);
    assert.equal(response.status, 200, `${path} должен открываться`);

    const title = (response.text.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
    assert.ok(title.length > 5, `${path}: нет title`);
    assert.ok(/Книгоманы/.test(title), `${path}: title без названия сайта`);

    const description = (response.text.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
    assert.ok(description.length >= 40, `${path}: короткое описание`);
    assert.ok(description.length <= 320, `${path}: описание длиннее 320 символов`);

    assert.match(response.text, /<link rel="canonical" href="http?:\/\/[^"]+">/, `${path}: нет canonical`);
    assert.match(response.text, /property="og:title"/, `${path}: нет og:title`);
    assert.match(response.text, /property="og:description"/, `${path}: нет og:description`);
  }
});

test('карточка книги размечена как Book и Review, без нарушения CSP', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const user = await ctx.createUser({ email: 'anna@example.com', name: 'Анна' });
  const book = await ctx.models.Book.create({
    slug: 'duna', title: 'Дюна', author: 'Фрэнк Герберт', pages: 600, isPublished: true
  });
  await ctx.models.Review.create({ userId: user.id, bookId: book.id, rating: 9, body: 'Подробная рецензия на «Дюну» для разметки.' });

  const response = await ctx.request.get('/knigi/duna');
  assert.equal(response.status, 200);

  const blocks = [...response.text.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  assert.equal(blocks.length >= 2, true, 'ожидали разметку книги и рецензии');

  const bookLd = JSON.parse(blocks[0][1]);
  assert.equal(bookLd['@type'], 'Book');
  assert.equal(bookLd.name, 'Дюна');
  assert.equal(bookLd.author.name, 'Фрэнк Герберт');

  const reviewLd = JSON.parse(blocks[1][1]);
  assert.equal(reviewLd['@type'], 'Review');
  assert.equal(reviewLd.reviewRating.ratingValue, 4.5);
  assert.equal(reviewLd.reviewRating.bestRating, 5);

  // Nonce в разметке совпадает с заголовком CSP — иначе браузер её заблокирует
  const csp = response.headers['content-security-policy'];
  const nonce = (csp.match(/'nonce-([^']+)'/) || [])[1];
  assert.ok(nonce, 'в CSP должен быть nonce');
  assert.match(response.text, new RegExp(`nonce="${nonce.replace(/[+*/]/g, '\\$&')}"`));
  assert.ok(!/unsafe-inline/.test(csp), 'unsafe-inline не нужен и с nonce');
});

test('sitemap.xml: только публичные адреса, валидный XML', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  await ctx.models.Book.create({ slug: 'duna', title: 'Дюна', author: 'Герберт', pages: 600, isPublished: true });
  await ctx.models.Club.create({
    slug: 'otkrytyy', name: 'Открытый клуб', description: 'Открытый клуб для всех', ownerId: 1, isPrivate: false
  }).catch(() => null);

  const response = await ctx.request.get('/sitemap.xml');
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /xml/);
  assert.match(response.text, /^<\?xml version="1.0"/);
  assert.match(response.text, /<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);
  assert.match(response.text, /\/knigi\/duna/);

  // Личных и служебных разделов в карте нет
  for (const forbidden of ['/admin', '/nastroyki', '/soobshcheniya', '/import', '/start']) {
    assert.ok(!response.text.includes(`<loc>http://localhost:3000${forbidden}`), `${forbidden} не должен попасть в sitemap`);
  }
});

test('robots.txt закрывает личные разделы и указывает sitemap', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const response = await ctx.request.get('/robots.txt');
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /text\/plain/);
  assert.match(response.text, /User-agent: \*/);
  assert.match(response.text, /Disallow: \/admin/);
  assert.match(response.text, /Disallow: \/soobshcheniya/);
  assert.match(response.text, /Sitemap: http/);
});

test('личные страницы закрыты от индексации', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  const { agent } = await signIn(ctx, 'anna@example.com', 'Анна');

  for (const path of ['/polka', '/nastroyki', '/statistika', '/lenta']) {
    const response = await agent.get(path);
    assert.match(response.text, /name="robots" content="noindex, nofollow"/, `${path}: должен быть noindex`);
  }
});

test('нет битых внутренних ссылок на главной и в каталоге', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  await ctx.models.Book.create({
    slug: 'duna', title: 'Дюна', author: 'Фрэнк Герберт', pages: 600, isPublished: true
  });

  const links = new Set();
  for (const path of ['/', '/knigi', '/kluby']) {
    const response = await ctx.request.get(path);
    for (const match of response.text.matchAll(/href="(\/[^"#?]*)/g)) {
      links.add(match[1]);
    }
  }

  assert.ok(links.size > 5, 'на страницах должны быть ссылки');

  for (const link of links) {
    if (link.startsWith('/assets')) continue;
    const response = await ctx.request.get(link);
    assert.ok(
      response.status < 400 || response.status === 403,
      `${link} отвечает ${response.status}`
    );
  }
});

test('у всех картинок есть alt, а у полей — подписи', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  await ctx.models.Book.create({ slug: 'duna', title: 'Дюна', author: 'Герберт', pages: 600, isPublished: true });

  for (const path of ['/', '/knigi', '/knigi/duna', '/pravila']) {
    const response = await ctx.request.get(path);
    const images = [...response.text.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    for (const image of images) {
      assert.match(image, /alt="/, `${path}: картинка без alt → ${image}`);
    }

    // Каждое поле ввода имеет либо label, либо aria-label
    const inputs = [...response.text.matchAll(/<input\b([^>]*)>/g)].map((m) => m[1]);
    for (const attributes of inputs) {
      const type = (attributes.match(/type="([^"]+)"/) || [])[1] || 'text';
      if (['hidden', 'submit', 'checkbox'].includes(type)) continue;
      const id = (attributes.match(/id="([^"]+)"/) || [])[1];
      const hasAria = /aria-label=/.test(attributes);
      const hasLabel = id ? new RegExp(`<label[^>]*for="${id}"`).test(response.text) : false;
      assert.ok(hasAria || hasLabel, `${path}: поле без подписи → ${attributes.trim()}`);
    }
  }
});

test('карточка книги отдаётся сжатой', async (t) => {
  const ctx = await createTestApp();
  t.after(() => ctx.close());

  await ctx.models.Book.create({ slug: 'duna', title: 'Дюна', author: 'Герберт', pages: 600, isPublished: true });

  const response = await ctx.request.get('/knigi/duna').set('Accept-Encoding', 'gzip');
  assert.match(String(response.headers['content-encoding'] || ''), /gzip/, 'страница должна приходить в gzip');
});
