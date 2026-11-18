'use strict';

const { Op } = require('sequelize');

/**
 * Наполнение из файлов: книги, подборки, авторы.
 *
 * Зачем отдельный сервис, а не «просто сид»:
 *  - на проде нужно залить 300 книг и 20 подборок без демо-читателей;
 *  - повторный запуск не должен создавать дубли и не должен перетирать
 *    правки, сделанные в админке;
 *  - перед записью контент проверяется целиком, а не по одной строке:
 *    лучше отказаться от загрузки, чем получить полкаталога.
 */

function createContentService({
  Book,
  BookGenre,
  Genre,
  Collection,
  CollectionBook,
  Author,
  Club,
  ClubMember,
  ClubSchedule,
  User,
  sequelize
}) {
  /**
   * Книга: создаём, если нет; существующую трогаем только если явно просили.
   * Так повторный запуск безопасен, а правки в админке не теряются.
   */
  async function upsertBook(item, { update = false } = {}) {
    const existing = await Book.findOne({ where: { slug: item.slug } });

    if (existing) {
      if (!update) return { book: existing, created: false, updated: false };
      await existing.update({
        title: item.title,
        author: item.author,
        description: item.description,
        year: item.year,
        pages: item.pages
      });
      return { book: existing, created: false, updated: true };
    }

    const book = await Book.create({
      slug: item.slug,
      title: item.title,
      author: item.author,
      description: item.description,
      year: item.year,
      pages: item.pages,
      cover: `covers/demo-${(Math.abs(hash(item.slug)) % 8) + 1}.svg`
    });
    return { book, created: true, updated: false };
  }

  /** Устойчивый от индекса хэш: одна и та же книга всегда с одной обложкой. */
  function hash(value) {
    let result = 0;
    for (let index = 0; index < value.length; index += 1) {
      result = ((result << 5) - result + value.charCodeAt(index)) | 0;
    }
    return result;
  }

  /** Жанр по названию: создаём, если такого ещё нет (на проде жанры могут отличаться). */
  async function ensureGenre(name) {
    if (!name) return null;
    const slug = slugFor(name);
    const [genre] = await Genre.findOrCreate({
      where: { slug },
      defaults: { name, slug, sortOrder: 100 }
    });
    return genre;
  }

  function slugFor(name) {
    // Тот же алгоритм, что в lib/slug: кириллица → латиница
    // eslint-disable-next-line global-require
    return require('../lib/slug').slugify(name, 'zhanr');
  }

  async function loadBooks(books, { update = false, genres = new Map() } = {}) {
    const result = { created: 0, updated: 0, skipped: 0, genresCreated: 0 };
    const genreCache = new Map(genres);

    for (const item of books) {
      const { book, created, updated } = await upsertBook(item, { update });
      if (created) result.created += 1;
      else if (updated) result.updated += 1;
      else result.skipped += 1;

      if (!item.genre) continue;

      let genre = genreCache.get(item.genre);
      if (!genre) {
        genre = await ensureGenre(item.genre);
        if (genre) {
          genreCache.set(item.genre, genre);
          result.genresCreated += 1;
        }
      }
      if (!genre) continue;

      const link = await BookGenre.findOne({ where: { bookId: book.id, genreId: genre.id } });
      if (!link) await BookGenre.create({ bookId: book.id, genreId: genre.id });
    }

    return { ...result, genreCache };
  }

  async function loadCollections(collections) {
    const result = { created: 0, updated: 0, books: 0 };

    for (const [index, item] of collections.entries()) {
      const [collection, created] = await Collection.findOrCreate({
        where: { slug: item.slug },
        defaults: {
          slug: item.slug,
          title: item.title,
          description: item.description,
          sortOrder: index
        }
      });

      if (!created) {
        await collection.update({ title: item.title, description: item.description, sortOrder: index });
        result.updated += 1;
      } else {
        result.created += 1;
      }

      const books = await Book.findAll({ where: { slug: { [Op.in]: item.books } }, attributes: ['id', 'slug'] });
      const bySlug = new Map(books.map((book) => [book.slug, book]));

      for (const [position, slug] of item.books.entries()) {
        const book = bySlug.get(slug);
        if (!book) continue;
        const [link, linkCreated] = await CollectionBook.findOrCreate({
          where: { collectionId: collection.id, bookId: book.id },
          defaults: { collectionId: collection.id, bookId: book.id, position }
        });
        if (!linkCreated && link.position !== position) await link.update({ position });
        if (linkCreated) result.books += 1;
      }
    }

    return result;
  }

  async function loadAuthors(authors) {
    const result = { created: 0, updated: 0 };

    for (const item of authors) {
      const [author, created] = await Author.findOrCreate({
        where: { slug: item.slug },
        defaults: { slug: item.slug, name: item.name, years: item.years, bio: item.bio }
      });

      if (!created) {
        await author.update({ name: item.name, years: item.years, bio: item.bio });
        result.updated += 1;
      } else {
        result.created += 1;
      }
    }

    return result;
  }

  /**
   * Загрузка всего контента разом.
   * validated — результат validateContent: туда уже не попадёт битая книга.
   */
  /**
   * Стартовые клубы: три клуба, в которых есть расписание и ведущий.
   *
   * Почему из файла, а не руками: пустой раздел клубов на старте читается
   * как «клубов нет и не будет». Ведущий задаётся адресом, потому что id
   * на разных базах разные; если такого человека нет — клуб не создаём:
   * клуб без ведущего мёртв в первый же день.
   */
  async function loadClubs(clubs, { ownerId = null } = {}) {
    const result = { created: 0, updated: 0, skipped: 0, missingOwners: [] };
    if (!clubs.length || !Club) return result;

    for (const item of clubs) {
      let owner = null;
      if (User && item.ownerEmail) {
        owner = await User.findOne({ where: { email: item.ownerEmail } });
      } else if (ownerId) {
        owner = await User.findByPk(ownerId);
      }

      if (!owner) {
        result.missingOwners.push(item.ownerEmail || item.slug);
        result.skipped += 1;
        continue;
      }

      const book = item.currentBookSlug
        ? await Book.findOne({ where: { slug: item.currentBookSlug } })
        : null;

      const [club, created] = await Club.findOrCreate({
        where: { slug: item.slug },
        defaults: {
          slug: item.slug,
          name: item.name,
          description: item.description,
          ownerId: owner.id,
          isPrivate: item.isPrivate,
          currentBookId: book ? book.id : null,
          lastActivityAt: new Date()
        }
      });

      // Существующий клуб не трогаем: правки (название, текущая книга,
      // участники) сделаны людьми, и повторный запуск — это «дозаполнить»
      if (created) result.created += 1;

      if (ClubMember) {
        await ClubMember.findOrCreate({
          where: { clubId: club.id, userId: owner.id },
          defaults: { clubId: club.id, userId: owner.id, role: 'lead' }
        });
      }

      if (ClubSchedule) {
        for (const slot of item.schedule) {
          const discussionOn = new Date(Date.now() + slot.inDays * 24 * 60 * 60 * 1000)
            .toISOString().slice(0, 10);
          await ClubSchedule.findOrCreate({
            where: { clubId: club.id, chapter: slot.chapter },
            defaults: { clubId: club.id, chapter: slot.chapter, discussionOn, note: slot.note }
          });
        }
      }
    }

    return result;
  }

  async function apply(content, { update = false, ownerId = null } = {}) {
    const books = await loadBooks(content.books, { update });
    const collections = await loadCollections(content.collections);
    const authors = await loadAuthors(content.authors);
    const clubs = await loadClubs(content.clubs || [], { ownerId });

    return {
      books: { created: books.created, updated: books.updated, skipped: books.skipped },
      collections,
      authors,
      clubs
    };
  }

  /** Сколько чего уже в базе — для команды CLI и страницы наполнения. */
  async function stats() {
    const [books, collections, authors, withDescription] = await Promise.all([
      Book.count(),
      Collection.count(),
      Author.count(),
      Book.count({ where: { description: { [Op.ne]: '' } } })
    ]);
    return { books, collections, authors, withDescription };
  }

  /** Подборка для страницы: книги в нужном порядке. */
  async function collectionBySlug(slug) {
    const collection = await Collection.findOne({
      where: { slug: String(slug || ''), isPublished: true }
    });
    if (!collection) return null;

    const links = await CollectionBook.findAll({
      where: { collectionId: collection.id },
      order: [['position', 'ASC'], ['id', 'ASC']],
      include: [{
        model: Book,
        as: 'book',
        attributes: ['id', 'slug', 'title', 'author', 'year', 'pages', 'cover', 'ratingsCount', 'ratingsSum', 'reviewsCount']
      }]
    });

    return {
      collection,
      books: links.map((link) => link.book).filter(Boolean).map((book) => {
        const ratingsSum = (Number(book.ratingsSum) || 0) / 2;
        const ratingsCount = Number(book.ratingsCount) || 0;
        return {
          ...book.get({ plain: true }),
          rating: ratingsCount ? Math.round((ratingsSum / ratingsCount) * 10) / 10 : 0
        };
      })
    };
  }

  async function collectionsList({ limit = 50 } = {}) {
    const collections = await Collection.findAll({
      where: { isPublished: true },
      order: [['sortOrder', 'ASC'], ['id', 'ASC']],
      limit
    });

    const counts = await sequelize.query(
      `SELECT collection_id, COUNT(*)::int AS count FROM collection_books GROUP BY collection_id`,
      { type: sequelize.QueryTypes.SELECT }
    );
    const byId = new Map(counts.map((row) => [row.collection_id, row.count]));

    return collections.map((collection) => ({
      ...collection.get({ plain: true }),
      booksCount: byId.get(collection.id) || 0
    }));
  }

  /** Страница автора: биография и все его книги в каталоге. */
  async function authorBySlug(slug) {
    const author = await Author.findOne({ where: { slug: String(slug || '') } });
    if (!author) return null;

    const books = await Book.findAll({
      where: { author: author.name, isPublished: true },
      order: [['year', 'ASC'], ['title', 'ASC']]
    });

    return {
      author,
      books: books.map((book) => {
        const ratingsSum = (Number(book.ratingsSum) || 0) / 2;
        const ratingsCount = Number(book.ratingsCount) || 0;
        return {
          ...book.get({ plain: true }),
          rating: ratingsCount ? Math.round((ratingsSum / ratingsCount) * 10) / 10 : 0
        };
      })
    };
  }

  async function authorsList({ limit = 100 } = {}) {
    const authors = await Author.findAll({ order: [['name', 'ASC']], limit });
    const names = authors.map((author) => author.name);
    const counts = await Book.findAll({
      where: { author: { [Op.in]: names } },
      attributes: ['author', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      group: ['author'],
      raw: true
    });
    const byName = new Map(counts.map((row) => [row.author, Number(row.count)]));

    return authors.map((author) => ({
      ...author.get({ plain: true }),
      booksCount: byName.get(author.name) || 0
    }));
  }

  /** Подборки, в которые входит книга — показываем на её странице. */
  async function collectionsForBook(bookId) {
    const links = await CollectionBook.findAll({
      where: { bookId },
      include: [{ model: Collection, as: 'collection', where: { isPublished: true }, attributes: ['slug', 'title'] }],
      limit: 5
    });
    return links.map((link) => link.collection).filter(Boolean);
  }

  return {
    apply,
    loadBooks,
    loadCollections,
    loadAuthors,
    loadClubs,
    stats,
    collectionBySlug,
    collectionsList,
    authorBySlug,
    authorsList,
    collectionsForBook
  };
}

module.exports = { createContentService };
