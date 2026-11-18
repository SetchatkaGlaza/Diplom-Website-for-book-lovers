'use strict';

const express = require('express');
const { publicUrl } = require('../config/env');

/**
 * SEO: sitemap.xml, robots.txt, Open Graph и микроразметка.
 *
 * Что важно:
 *  - в sitemap попадают только публичные страницы: книги, жанры, открытые клубы;
 *  - закрытые профили и служебные разделы закрыты в robots.txt;
 *  - canonical строится от PUBLIC_URL, а не от заголовка Host: иначе сайт
 *    индексируется по любому домену, который на него смотрит.
 *
 * Разметку Book и Review собираем вручную (JSON-LD) и экранируем значения:
 * название книги может содержать кавычки и угловые скобки.
 */
module.exports = function seoRoutes({ models, services }) {
  const router = express.Router();

  const base = publicUrl();

  function xmlEscape(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  router.get('/sitemap.xml', async (req, res, next) => {
    try {
      const [books, genres, clubs, collections, authors] = await Promise.all([
        models.Book.findAll({
          where: { isPublished: true },
          attributes: ['slug', 'updatedAt'],
          order: [['id', 'ASC']],
          limit: 5000
        }),
        models.Genre.findAll({ attributes: ['slug'], limit: 500 }),
        models.Club.findAll({ where: { isPrivate: false }, attributes: ['slug', 'updatedAt'], limit: 1000 }),
        models.Collection.findAll({
          where: { isPublished: true },
          attributes: ['slug', 'updatedAt'],
          order: [['sortOrder', 'ASC']],
          limit: 200
        }),
        models.Author.findAll({ attributes: ['slug'], limit: 500 })
      ]);

      const staticPages = [
        { loc: '/', priority: '1.0', changefreq: 'daily' },
        { loc: '/knigi', priority: '0.9', changefreq: 'daily' },
        { loc: '/podborki', priority: '0.8', changefreq: 'weekly' },
        { loc: '/avtory', priority: '0.6', changefreq: 'weekly' },
        { loc: '/zhurnal', priority: '0.8', changefreq: 'weekly' },
        { loc: '/knizhnyy-god-primer', priority: '0.8', changefreq: 'monthly' },
        { loc: '/kluby', priority: '0.7', changefreq: 'weekly' },
        { loc: '/pravila', priority: '0.3', changefreq: 'monthly' },
        { loc: '/soglashenie', priority: '0.3', changefreq: 'monthly' },
        { loc: '/konfidentsialnost', priority: '0.3', changefreq: 'monthly' },
        { loc: '/pravoobladatelyam', priority: '0.4', changefreq: 'monthly' },
        { loc: '/o-proekte', priority: '0.4', changefreq: 'monthly' },
        { loc: '/klubam-i-bibliotekam', priority: '0.5', changefreq: 'monthly' }
      ];

      // Статьи журнала: единственная часть сайта, которая растёт без
      // действий читателей, поэтому в sitemap они идут отдельным блоком
      const journal = (req.app.locals && req.app.locals.articlesService) || services.articleService;
      const articles = journal && journal.isReady ? journal.all() : [];
      const articleUrls = articles.map((article) => `  <url>
    <loc>${base}/zhurnal/${xmlEscape(article.slug)}</loc>
${article.datePublished ? `    <lastmod>${xmlEscape(article.datePublished)}</lastmod>\n` : ''}    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`);

      const urls = [
        ...staticPages.map((page) => `  <url>
    <loc>${base}${page.loc}</loc>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`),
        ...books.map((book) => `  <url>
    <loc>${base}/knigi/${xmlEscape(book.slug)}</loc>
    <lastmod>${new Date(book.updatedAt).toISOString().slice(0, 10)}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`),
        ...genres.map((genre) => `  <url>
    <loc>${base}/knigi?zhanr=${xmlEscape(genre.slug)}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.5</priority>
  </url>`),
        ...collections.map((collection) => `  <url>
    <loc>${base}/podborki/${xmlEscape(collection.slug)}</loc>
    <lastmod>${new Date(collection.updatedAt).toISOString().slice(0, 10)}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`),
        ...authors.map((author) => `  <url>
    <loc>${base}/avtory/${xmlEscape(author.slug)}</loc>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>`),
        ...articleUrls,
        ...clubs.map((club) => `  <url>
    <loc>${base}/kluby/${xmlEscape(club.slug)}</loc>
    <lastmod>${new Date(club.updatedAt).toISOString().slice(0, 10)}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.5</priority>
  </url>`)
      ];

      res.type('application/xml');
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    return res.send([
      'User-agent: *',
      'Allow: /',
      'Disallow: /admin',
      'Disallow: /nastroyki',
      'Disallow: /soobshcheniya',
      'Disallow: /uvedomleniya',
      'Disallow: /eksport',
      'Disallow: /import',
      'Disallow: /vhod',
      'Disallow: /registratsiya',
      'Disallow: /vosstanovit-parol',
      '',
      `Sitemap: ${base}/sitemap.xml`,
      ''
    ].join('\n'));
  });

  return router;
};
