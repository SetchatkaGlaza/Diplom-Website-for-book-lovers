'use strict';

const express = require('express');
const { HttpError } = require('../lib/errors');
const v = require('../lib/validate');

/**
 * «Журнал» — раздел статей о чтении.
 *
 * Зачем он сайту:
 *  - на сайт приходят не только «у меня 200 книг, куда их записать», но и
 *    «что почитать» — такие запросы статья закрывает лучше каталога;
 *  - статья — вход в продукт: в конце каждой стоит ссылка на полку или
 *    на подборку, а не «зарегистрируйтесь, чтобы узнать больше»;
 *  - тексты лежат в content/articles.json, деплой для новой статьи не нужен.
 *
 * Страницы публичные и индексируются: это единственная часть сайта, которая
 * растёт без действий читателей.
 */
const EMPTY = {
  all: () => [],
  one: () => null,
  topics: () => [],
  related: () => [],
  stats: () => ({ count: 0, words: 0, topics: 0 }),
  isReady: false
};

module.exports = function journalRoutes({ services }) {
  const router = express.Router();

  /**
   * Сервис создаётся в app.js и кладётся в locals: так тесты могут подсунуть
   * свой набор статей, не трогая файл. Если articles.json не прочитался,
   * сервиса нет — отдаём пустой журнал вместо 500 на весь раздел.
   */
  function articleService(req) {
    return (req.app.locals && req.app.locals.articlesService)
      || (services && services.articleService)
      || EMPTY;
  }

  // --- список статей ---
  router.get('/zhurnal', (req, res, next) => {
    try {
      const journal = articleService(req);
      const topics = journal.topics();
      const requested = v.str(req.query.tema, 40);
      const active = topics.some((item) => item.name === requested) ? requested : null;

      // Группы по темам: список из тридцати статей подряд читать невозможно,
      // а «Практика / Подборки / Клубы» — это ещё и оглавление раздела
      const groups = (active ? topics.filter((topic) => topic.name === active) : topics)
        .map((topic) => ({ ...topic, articles: journal.all({ topic: topic.name }) }));

      res.render('journal/index', {
        title: active ? `Журнал: ${active.toLowerCase()}` : 'Журнал о чтении',
        description: 'Журнал Книгоманов: как читать больше, что делать с недочитанными книгами, как вести дневник и что выбрать в подарок. Без «десяти книг, которые изменят жизнь».',
        groups,
        topics,
        activeTopic: active,
        stats: journal.stats(),
        isReady: journal.isReady
      });
    } catch (error) {
      return next(error);
    }
  });

  // --- одна статья ---
  router.get('/zhurnal/:slug', (req, res, next) => {
    try {
      const slug = v.slug(req.params.slug);
      if (slug.error) return next(new HttpError(404, 'Статья не найдена'));

      const journal = articleService(req);
      const article = journal.one(slug.value);
      if (!article) return next(new HttpError(404, 'Статья не найдена'));

      res.render('journal/article', {
        title: article.title,
        description: article.description,
        article,
        related: journal.related(article.slug, 3),
        // Статьи — единственный раздел, где дата видна человеку: по ней
        // понятно, насколько текст свежий
        publishedLabel: article.datePublished
          ? new Date(`${article.datePublished}T00:00:00Z`).toLocaleDateString('ru-RU', {
            day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
          })
          : null
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
};
