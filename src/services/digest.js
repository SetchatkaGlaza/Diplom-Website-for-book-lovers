'use strict';

const crypto = require('crypto');
const { Op } = require('sequelize');

/**
 * Дайджест: письмо «что у вас на полке и что нового».
 *
 * Зачем: люди не возвращаются не потому, что им не понравилось, а потому,
 * что забыли. Письмо раз в неделю — самый дешёвый способ напомнить.
 *
 * Правила, которые важнее функций:
 *  - пишем только тем, кто сам включил галочку и подтвердил адрес;
 *  - одно письмо в неделю, повторный запуск не отправляет дубль (уникальный
 *    индекс в digests);
 *  - в каждом письме — ссылка отписки, и отписка работает без входа;
 *  - «возврат ушедших» (comeback) — не чаще одного раза на человека и
 *    только тем, кто был активен раньше, а сейчас молчит 21 день.
 *
 * Сервис ничего не знает про транспорт: письмо собирается здесь, отправка
 * приходит снаружи функцией send. Так тесты проверяют текст и правила, не
 * поднимая SMTP.
 */

const DAY = 24 * 60 * 60 * 1000;
const RULES = {
  // Молчание, после которого имеет смысл напомнить о себе
  comebackDays: 21,
  // И «совсем ушёл»: письма чаще раза в три недели превращаются в спам
  comebackCooldownDays: 21,
  // Период обычного дайджеста
  periodDays: 7,
  // Не больше стольких писем за прогон: Resend и SMTP не любят всплесков
  batchSize: Math.max(1, Math.min(500, Number(process.env.DIGEST_BATCH) || 50)),
  // Максимум книг в письме: длинное письмо не читают
  booksInLetter: 3
};

/** Хеш адреса для ссылки отписки: без секрета, чтобы ссылка жила годами. */
function emailHash(email) {
  return crypto.createHash('sha256').update(String(email || '').trim().toLowerCase()).digest('hex');
}

/** Начало недели (понедельник, UTC) — период, за который считаем статистику. */
function weekStart(now = new Date()) {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = date.getUTCDay() || 7; // воскресенье = 7, чтобы неделя начиналась с понедельника
  date.setUTCDate(date.getUTCDate() - (day - 1));
  return date;
}

function formatDate(date) {
  return new Date(date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

function plural(count, forms) {
  const abs = Math.abs(count) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

function createDigestService({
  User,
  LibraryEntry,
  Book,
  Digest,
  EmailUnsubscribe,
  ReadingGoal,
  sequelize,
  send = async () => {},
  baseUrl = () => 'http://localhost:3000',
  now = () => new Date()
}) {
  /**
   * Кому можно писать: галочка включена, адрес подтверждён, аккаунт не
   * удалён и не заблокирован, отписки нет. Условия собраны в одном месте,
   * чтобы «кому пишем» нельзя было случайно расширить в одном запросе.
   */
  async function recipients({ kind = 'weekly', limit = RULES.batchSize, inactiveForDays = null } = {}) {
    const users = await User.findAll({
      where: {
        notifyDigest: true,
        emailVerifiedAt: { [Op.ne]: null },
        deletedAt: null,
        isBlocked: false
      },
      attributes: ['id', 'name', 'email', 'lastActiveAt'],
      order: [['id', 'ASC']],
      limit: limit * 4
    });
    if (!users.length) return [];

    const unsubscribed = new Set(
      (await EmailUnsubscribe.findAll({ attributes: ['emailHash'], raw: true })).map((row) => row.emailHash)
    );

    const cutoff = inactiveForDays ? new Date(now().getTime() - inactiveForDays * DAY) : null;

    return users
      .filter((user) => !unsubscribed.has(emailHash(user.email)))
      .filter((user) => {
        if (!cutoff) return true;
        if (!user.lastActiveAt) return true;
        return new Date(user.lastActiveAt) < cutoff;
      })
      .filter((user) => kind === 'weekly' || user.lastActiveAt !== null)
      .slice(0, limit);
  }

  /** Данные для письма: что дочитано за неделю, что читается, прогресс к цели. */
  async function digestData(userId, { periodStart = weekStart(now()), periodEnd = null } = {}) {
    const end = periodEnd || new Date(periodStart.getTime() + RULES.periodDays * DAY);

    const finished = await LibraryEntry.findAll({
      where: {
        userId,
        status: 'read',
        finishedAt: { [Op.gte]: periodStart, [Op.lt]: end }
      },
      include: [{ model: Book, as: 'book', attributes: ['slug', 'title', 'author', 'pages'] }],
      order: [['finishedAt', 'DESC']],
      limit: RULES.booksInLetter
    });

    const reading = await LibraryEntry.findAll({
      where: { userId, status: 'reading' },
      include: [{ model: Book, as: 'book', attributes: ['slug', 'title', 'author', 'pages'] }],
      order: [['updatedAt', 'DESC']],
      limit: RULES.booksInLetter
    });

    const want = await LibraryEntry.count({ where: { userId, status: 'want' } });

    const year = periodStart.getUTCFullYear();
    const goal = ReadingGoal ? await ReadingGoal.findOne({ where: { userId, year } }) : null;
    const readThisYear = await LibraryEntry.count({
      where: {
        userId,
        status: 'read',
        finishedAt: { [Op.gte]: new Date(Date.UTC(year, 0, 1)), [Op.lt]: new Date(Date.UTC(year + 1, 0, 1)) }
      }
    });

    return {
      books: finished.map((entry) => ({
        slug: entry.book?.slug || '',
        title: entry.book?.title || '',
        author: entry.book?.author || '',
        pages: Number(entry.book?.pages) || 0
      })),
      reading: reading.map((entry) => ({
        slug: entry.book?.slug || '',
        title: entry.book?.title || '',
        author: entry.book?.author || ''
      })),
      want,
      goal: goal ? { target: goal.targetBooks, done: readThisYear } : null,
      readThisYear
    };
  }

  /** Текст письма. HTML и текстовая версия из одних данных — не расходятся. */
  function render({ user, data, kind = 'weekly', unsubscribeUrl, site }) {
    const name = user.name || 'читатель';
    const lines = [];
    const paragraphs = [];

    if (kind === 'comeback') {
      paragraphs.push(`<p>Здравствуйте, ${name}!</p>`);
      paragraphs.push('<p>Вас давно не было на Книгоманах. Полка на месте — можно ничего не восстанавливать, просто зайти и отметить, что вы сейчас читаете.</p>');
      if (data.reading.length) {
        paragraphs.push(`<p>У вас открыто: ${data.reading.map((book) => `«${book.title}»`).join(', ')}. Продолжим?</p>`);
      }
      if (data.want) {
        paragraphs.push(`<p>В «Хочу прочитать» лежит ${data.want} ${plural(data.want, ['книга', 'книги', 'книг'])} — обычно оттуда и начинают.</p>`);
      }
      lines.push('Здравствуйте!', 'Вас давно не было на Книгоманах. Полка на месте — зайдите и отметьте, что читаете.');
    } else {
      paragraphs.push(`<p>Здравствуйте, ${name}!</p>`);
      if (data.books.length) {
        paragraphs.push(`<p>За неделю вы дочитали ${data.books.length} ${plural(data.books.length, ['книгу', 'книги', 'книг'])}:</p>`);
        paragraphs.push(`<ul>${data.books.map((book) => `<li>«${book.title}» — ${book.author}</li>`).join('')}</ul>`);
        lines.push(`За неделю дочитано: ${data.books.map((book) => `«${book.title}»`).join(', ')}.`);
      } else {
        paragraphs.push('<p>За эту неделю новых закрытых книг нет — это нормально. Иногда неделя уходит на одну главу.</p>');
        lines.push('За эту неделю новых закрытых книг нет — это нормально.');
      }

      if (data.reading.length) {
        paragraphs.push(`<p>Сейчас читаете: ${data.reading.map((book) => `«${book.title}»`).join(', ')}.</p>`);
        lines.push(`Сейчас читаете: ${data.reading.map((book) => `«${book.title}»`).join(', ')}.`);
      }

      if (data.goal) {
        const left = Math.max(0, data.goal.target - data.goal.done);
        paragraphs.push(`<p>Цель на год: ${data.goal.done} из ${data.goal.target}. ${left ? `Осталось ${left}.` : 'Цель выполнена — можно поднять планку.'}</p>`);
        lines.push(`Цель на год: ${data.goal.done} из ${data.goal.target}.`);
      }
    }

    paragraphs.push(`<p><a href="${site}/polka">Открыть полку</a></p>`);
    paragraphs.push(`<p style="font-size:12px;color:#8a8175">Не хотите таких писем? <a href="${unsubscribeUrl}">Отписаться</a> — это один клик, входить не нужно.</p>`);
    lines.push('', `Полка: ${site}/polka`, `Отписаться: ${unsubscribeUrl}`);

    return {
      subject: kind === 'comeback'
        ? 'Ваша полка ждёт'
        : `Ваша неделя в книгах${data.books.length ? `: ${data.books.length} ${plural(data.books.length, ['книга', 'книги', 'книг'])}` : ''}`,
      html: paragraphs.join('\n'),
      text: lines.join('\n')
    };
  }

  /**
   * Один прогон рассылки.
   *
   * dryRun — собрать письма, ничего не отправляя и не записывая: так проверяют
   * текст на проде, не разослав его.
   */
  async function run({
    kind = 'weekly',
    dryRun = false,
    limit = RULES.batchSize,
    periodStart = weekStart(now()),
    sendFn = null
  } = {}) {
    const site = baseUrl();
    const periodEnd = new Date(periodStart.getTime() + RULES.periodDays * DAY);
    const list = await recipients({
      kind,
      limit,
      inactiveForDays: kind === 'comeback' ? RULES.comebackDays : null
    });

    const result = { kind, dryRun, candidates: list.length, sent: 0, skipped: 0, failed: 0, letters: [] };
    const transport = sendFn || send;

    for (const user of list) {
      // Уже писали об этом периоде — второе письмо о той же неделе не нужно
      const existing = await Digest.findOne({
        where: { userId: user.id, kind, periodStart }
      });
      if (existing) {
        result.skipped += 1;
        continue;
      }

      if (kind === 'comeback') {
        const recent = await Digest.findOne({
          where: {
            userId: user.id,
            kind: 'comeback',
            sentAt: { [Op.gte]: new Date(now().getTime() - RULES.comebackCooldownDays * DAY) }
          }
        });
        if (recent) {
          result.skipped += 1;
          continue;
        }
      }

      const data = await digestData(user.id, { periodStart, periodEnd });
      const letter = render({
        user,
        data,
        kind,
        site,
        unsubscribeUrl: `${site}/otpiska?e=${emailHash(user.email)}`
      });

      if (dryRun) {
        result.letters.push({ to: user.email, subject: letter.subject, text: letter.text });
        continue;
      }

      const record = await Digest.create({
        userId: user.id,
        kind,
        periodStart,
        periodEnd,
        status: 'queued'
      });

      try {
        await transport({ to: user.email, subject: letter.subject, html: letter.html, text: letter.text });
        await record.update({ status: 'sent', sentAt: now() });
        result.sent += 1;
      } catch (error) {
        // Ошибка одного адреса не должна останавливать рассылку остальным
        await record.update({ status: 'failed', error: String(error.message || error).slice(0, 1000) });
        result.failed += 1;
      }
    }

    return result;
  }

  /** Отписка по ссылке из письма. Идемпотентна: повторный клик не ошибка. */
  async function unsubscribe(email, { kind = 'all', reason = '' } = {}) {
    const hash = emailHash(email);
    const [record] = await EmailUnsubscribe.findOrCreate({
      where: { emailHash: hash },
      defaults: { emailHash: hash, kind, reason: String(reason).slice(0, 200) }
    });

    // Галочку в аккаунте тоже снимаем: иначе человек «отписался», а в
    // настройках у него всё ещё стоит «присылать письма»
    await User.update({ notifyDigest: false }, { where: { email: String(email).trim().toLowerCase() } });
    return record;
  }

  async function isUnsubscribed(email) {
    const record = await EmailUnsubscribe.findOne({ where: { emailHash: emailHash(email) } });
    return Boolean(record);
  }

  /** Статистика для админки: сколько писем ушло, сколько сломалось. */
  async function stats({ days = 30 } = {}) {
    const since = new Date(now().getTime() - days * DAY);
    const rows = await Digest.findAll({
      attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'total']],
      where: { createdAt: { [Op.gte]: since } },
      group: ['status'],
      raw: true
    });
    const byStatus = Object.fromEntries(rows.map((row) => [row.status, Number(row.total)]));
    return {
      days,
      sent: byStatus.sent || 0,
      failed: byStatus.failed || 0,
      skipped: byStatus.skipped || 0,
      queued: byStatus.queued || 0,
      unsubscribed: await EmailUnsubscribe.count()
    };
  }

  return {
    recipients,
    digestData,
    render,
    run,
    unsubscribe,
    isUnsubscribed,
    stats,
    RULES
  };
}

module.exports = { createDigestService, emailHash, weekStart, plural, RULES };
