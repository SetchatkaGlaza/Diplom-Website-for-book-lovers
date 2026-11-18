'use strict';

const express = require('express');
const sharp = require('sharp');
const { HttpError } = require('../lib/errors');
const { buildCoverSvg, SIZES: COVER_SIZES } = require('../services/cover');
const { buildAvatarSvg, buildAuthorSvg, buildClubSvg } = require('../services/portrait');
const { GENRE_PALETTE } = require('../services/cover');

/**
 * Картинки, которые рисует сервер.
 *
 * Зачем так, а не 345 файлов в репозитории:
 *  - новая книга сразу получает обложку, битых ссылок не бывает;
 *  - один адрес на одну книгу, поэтому картинку можно кэшировать
 *    «навсегда»: содержимое меняется только вместе с названием;
 *  - SVG не отдаём наружу: в нём можно спрятать скрипт, а браузер
 *    исполнит его на нашем домене. Отдаём PNG, собранный sharp.
 *
 * Кэш: ETag по содержимому + Cache-Control. При повторном заходе браузер
 * получает 304 и не качает картинку заново.
 */
module.exports = function imageRoutes({ models, services }) {
  const router = express.Router();

  /** Простой хэш содержимого: он же ETag. */
  function etagOf(buffer) {
    const crypto = require('node:crypto');
    return `"${crypto.createHash('sha1').update(buffer).digest('hex')}"`;
  }

  async function sendPng(req, res, svg, { maxAge = 60 * 60 * 24 * 30 } = {}) {
    const buffer = await sharp(Buffer.from(svg, 'utf8'), { density: 96 })
      .png({ compressionLevel: 9 })
      .toBuffer();

    const tag = etagOf(buffer);
    // Сильный ETag: содержимое не зависит от времени, только от параметров
    res.set('ETag', tag);
    res.set('Cache-Control', `public, max-age=${maxAge}, stale-while-revalidate=86400`);
    res.type('png');
    if (req.headers['if-none-match'] === tag) return res.status(304).end();
    return res.send(buffer);
  }

  /** Обложка книги: /kartinki/oblozhka/<slug>?size=card|large */
  router.get('/kartinki/oblozhka/:slug', async (req, res, next) => {
    try {
      const slug = String(req.params.slug || '');
      const book = await models.Book.findOne({
        where: { slug },
        include: [{ model: models.Genre, as: 'genres', attributes: ['name'], through: { attributes: [] } }]
      });
      if (!book || !book.isPublished) return next(new HttpError(404, 'Обложка не найдена'));

      const size = COVER_SIZES[req.query.size] ? req.query.size : 'card';
      const svg = buildCoverSvg({
        title: book.title,
        author: book.author,
        genre: book.genres && book.genres[0] ? book.genres[0].name : '',
        slug: book.slug,
        size
      });

      return sendPng(req, res, svg, { maxAge: 60 * 60 * 24 * 30 });
    } catch (error) {
      return next(error);
    }
  });

  /** Обложка клуба: /kartinki/klub/<slug> */
  router.get('/kartinki/klub/:slug', async (req, res, next) => {
    try {
      const club = await models.Club.findOne({
        where: { slug: String(req.params.slug || '') },
        attributes: ['slug', 'name', 'membersCount', 'postsCount']
      });
      if (!club) return next(new HttpError(404, 'Обложка клуба не найдена'));

      const svg = buildClubSvg({
        name: club.name,
        members: Number(club.membersCount) || 0,
        meetings: Number(club.postsCount) || 0
      });
      return sendPng(req, res, svg, { maxAge: 60 * 60 * 24 * 7 });
    } catch (error) {
      return next(error);
    }
  });

  /** Аватар читателя по id: /kartinki/avatar/<id> */
  router.get('/kartinki/avatar/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return next(new HttpError(404, 'Аватар не найден'));

      const user = await models.User.findByPk(id, { attributes: ['id', 'name', 'avatar'] });
      if (!user || user.deletedAt) return next(new HttpError(404, 'Аватар не найден'));

      const svg = buildAvatarSvg({ name: user.name, pivot: user.id, size: 160 });
      return sendPng(req, res, svg, { maxAge: 60 * 60 * 24 * 30 });
    } catch (error) {
      return next(error);
    }
  });

  /** Портрет автора: /kartinki/avtor/<slug> */
  router.get('/kartinki/avtor/:slug', async (req, res, next) => {
    try {
      const author = await models.Author.findOne({ where: { slug: String(req.params.slug || '') } });
      if (!author) return next(new HttpError(404, 'Портрет не найден'));

      // Палитра берётся у жанра, в котором автор пишет: так полка авторов
      // не выглядит одним цветом, но и не превращается в радугу
      const books = await models.Book.findAll({
        where: { author: author.name, isPublished: true },
        limit: 1,
        include: [{ model: models.Genre, as: 'genres', attributes: ['name'], through: { attributes: [] } }]
      });
      const genreName = books[0] && books[0].genres && books[0].genres[0] ? books[0].genres[0].name : '';
      const palette = GENRE_PALETTE[genreName] || { accent: '#c99a2e' };
      const spine = GENRE_PALETTE[genreName] ? GENRE_PALETTE[genreName].spine : '#2b5041';

      const svg = buildAuthorSvg({
        name: author.name,
        years: author.years || '',
        size: 480,
        accent: palette.accent,
        paper: palette.paper || '#f4f1ea',
        ink: palette.ink || '#121314'
      });
      void spine;
      return sendPng(req, res, svg, { maxAge: 60 * 60 * 24 * 30 });
    } catch (error) {
      return next(error);
    }
  });

  /** OG-картинка для соцсетей: одна на сайт, статичная по смыслу. */
  router.get('/kartinki/og.png', async (req, res, next) => {
    try {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
        <rect width="1200" height="630" fill="#fbfaf7"/>
        <rect x="0" y="0" width="1200" height="10" fill="#f5b935"/>
        <g transform="translate(72 96)">
          <rect width="108" height="108" rx="24" fill="#121314"/>
          <rect x="28" y="26" width="11" height="56" rx="3" fill="#f5b935"/>
          <rect x="47" y="26" width="11" height="56" rx="3" fill="#f5b935"/>
          <rect x="66" y="26" width="10" height="56" rx="3" fill="#2b5041"/>
        </g>
        <text x="72" y="300" font-family="DejaVu Serif, Georgia, serif" font-size="86" font-weight="700" fill="#121314" letter-spacing="-2">Читай. Считай.</text>
        <text x="72" y="392" font-family="DejaVu Serif, Georgia, serif" font-size="86" font-weight="700" fill="#2b5041" letter-spacing="-2">Обсуждай.</text>
        <text x="72" y="470" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-size="30" fill="#6b655c">Читательский дневник: полка, прогресс, статистика и клубы.</text>
        <text x="72" y="560" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-size="26" fill="#121314" letter-spacing="4">КНИГОМАНЫ · KNIGOMANY.RU</text>
        <circle cx="1090" cy="120" r="130" fill="none" stroke="#f5b935" stroke-width="6" opacity="0.5"/>
        <circle cx="1090" cy="120" r="70" fill="#f5b935" opacity="0.18"/>
      </svg>`;

      const buffer = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
      const tag = etagOf(buffer);
      res.set('ETag', tag);
      res.set('Cache-Control', 'public, max-age=604800');
      res.type('png');
      if (req.headers['if-none-match'] === tag) return res.status(304).end();
      return res.send(buffer);
    } catch (error) {
      return next(error);
    }
  });

  return router;
};
