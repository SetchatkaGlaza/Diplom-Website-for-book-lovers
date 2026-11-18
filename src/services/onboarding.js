'use strict';

const { Op } = require('sequelize');

/**
 * Онбординг: три шага после регистрации — жанры, три книги, цель на год.
 *
 * Зачем: пустая полка — худший первый экран. Человек выбирает жанры,
 * мы сразу показываем книги этих жанров, он добавляет три на полку
 * и ставит цель. После этого главная уже не пустая.
 *
 * Шаги идемпотентны: можно вернуться назад и поменять выбор,
 * повторный POST не создаёт дубли.
 */

const STEPS = [
  { key: 'zhanry', number: 1, title: 'Что вам нравится' },
  { key: 'knigi', number: 2, title: 'Три книги на старт' },
  { key: 'tsel', number: 3, title: 'Цель на год' }
];

function createOnboardingService({ Genre, Book, LibraryEntry, ReadingGoal, sequelize }) {
  /** Книги по выбранным жанрам с оценкой, сколько людей их уже читают. */
  async function suggestions({ genreIds = [], limit = 12, excludeUserId = null } = {}) {
    const ids = (genreIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0).slice(0, 10);

    const include = [{
      association: 'genres',
      attributes: ['id', 'name', 'slug'],
      through: { attributes: [] },
      ...(ids.length ? { where: { id: { [Op.in]: ids } } } : {})
    }];

    const books = await Book.findAll({
      where: { isPublished: true },
      include,
      order: [['ratingsCount', 'DESC'], ['title', 'ASC']],
      limit: Math.min(60, Math.max(1, limit * 3))
    });

    if (!books.length) return [];

    // Уже на полке — не предлагаем
    let onShelf = new Set();
    if (excludeUserId) {
      const entries = await LibraryEntry.findAll({
        where: { userId: excludeUserId, bookId: { [Op.in]: books.map((book) => book.id) } },
        attributes: ['bookId'],
        raw: true
      });
      onShelf = new Set(entries.map((row) => row.bookId));
    }

    return books
      .filter((book) => !onShelf.has(book.id))
      .slice(0, limit)
      .map((book) => ({
        id: book.id,
        slug: book.slug,
        title: book.title,
        author: book.author,
        pages: book.pages,
        rating: book.getAverageRating ? book.getAverageRating() : 0,
        genres: (book.genres || []).map((genre) => genre.name)
      }));
  }

  /** Рекомендации для пустой полки: без выбранных жанров — просто популярное. */
  async function forEmptyShelf(userId, limit = 6) {
    return suggestions({ limit, excludeUserId: userId });
  }

  /** Сохранение первого шага: жанры. Не больше 10. */
  async function saveGenres({ userId, genreIds = [] }) {
    const ids = [...new Set((genreIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    if (ids.length > 10) return { error: 'Выберите не больше 10 жанров' };

    const found = await Genre.findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id'] });
    if (found.length !== ids.length) return { error: 'Один из жанров не найден' };

    // Отдельную таблицу под выбор жанров не заводим: жанры уже видны
    // по полке и рецензиям, а «настройки вкуса» нужны только на этом шаге.
    return { genreIds: found.map((genre) => genre.id) };
  }

  /** Второй шаг: до трёх книг на полку «хочу прочитать». */
  async function saveBooks({ userId, bookIds = [] }) {
    const ids = [...new Set((bookIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    if (ids.length > 3) return { error: 'На старте достаточно трёх книг' };
    if (!ids.length) return { error: 'Выберите хотя бы одну книгу' };

    const books = await Book.findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id'] });
    if (books.length !== ids.length) return { error: 'Одна из книг не найдена' };

    for (const book of books) {
      const existing = await LibraryEntry.findOne({ where: { userId, bookId: book.id } });
      if (!existing) await LibraryEntry.create({ userId, bookId: book.id, status: 'want' });
    }

    return { added: books.length };
  }

  /** Третий шаг: цель года. */
  async function saveGoal({ userId, target, year = new Date().getFullYear() }) {
    const value = Number(target);
    if (!Number.isInteger(value) || value < 1 || value > 1000) {
      return { error: 'Цель: целое число от 1 до 1000 книг' };
    }
    if (!ReadingGoal) return { error: 'Цели пока недоступны' };

    const existing = await ReadingGoal.findOne({ where: { userId, year } });
    if (existing) await existing.update({ targetBooks: value });
    else await ReadingGoal.create({ userId, year, targetBooks: value });

    return { target: value, year };
  }

  return { suggestions, forEmptyShelf, saveGenres, saveBooks, saveGoal, STEPS };
}

module.exports = { createOnboardingService, STEPS };
