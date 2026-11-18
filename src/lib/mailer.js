'use strict';

const nodemailer = require('nodemailer');

/**
 * Отправка писем. В dev без SMTP письмо печатается в лог — но код отправки
 * один и тот же, поэтому «на проде письма не уходят» больше невозможно.
 */
function buildTransport(env = process.env) {
  if (env.RESEND_API_KEY) {
    return {
      kind: 'resend',
      async send({ to, subject, html, text }) {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: env.MAIL_FROM || 'Книгоманы <noreply@knigomany.ru>',
            to: [to],
            subject,
            html,
            text
          })
        });
        if (!response.ok) {
          throw new Error(`Resend ${response.status}: ${await response.text()}`);
        }
      }
    };
  }

  if (env.SMTP_HOST) {
    const transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT) || 587,
      secure: env.SMTP_SECURE === 'true',
      auth: env.SMTP_USER
        ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
        : undefined
    });
    return {
      kind: 'smtp',
      send: (message) => transporter.sendMail({
        from: env.MAIL_FROM || 'Книгоманы <noreply@knigomany.ru>',
        ...message
      })
    };
  }

  return {
    kind: 'console',
    async send({ to, subject, text }) {
      console.info(`[mail:dev] -> ${to} | ${subject} | ${String(text || '').slice(0, 120)}`);
    }
  };
}

/** Транспорт создаётся при первом письме, а не при импорте модуля. */
let cachedTransport = null;
function getTransport() {
  if (!cachedTransport) cachedTransport = buildTransport();
  return cachedTransport;
}

/**
 * Что делать, если почта не настроена.
 *
 * В разработке молча пишем в лог. В продакшене — громко ругаемся: человек
 * нажал «забыли пароль», письма нет, и без строчки в журнале это не найти.
 */
function assertMailReady({ env = process.env, logger = console } = {}) {
  if (env.NODE_ENV !== 'production') return true;
  if (env.RESEND_API_KEY || env.SMTP_HOST) return true;

  logger.error?.('[mail] в продакшене не настроен транспорт: письма не дойдут до людей', {
    hint: 'нужен RESEND_API_KEY или SMTP_HOST'
  });
  return false;
}

async function sendMail({ to, subject, html, text }) {
  await getTransport().send({ to, subject, html, text });
}

function layout(title, bodyHtml) {
  return `<!DOCTYPE html><html lang="ru"><body style="margin:0;background:#f6f4ef;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#23201c">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px">
    <div style="font-size:20px;font-weight:700;letter-spacing:-0.02em;margin-bottom:24px">Книгоманы</div>
    <div style="background:#fff;border-radius:16px;padding:28px;border:1px solid #e6e0d6">
      <h1 style="font-size:19px;margin:0 0 14px">${title}</h1>
      ${bodyHtml}
    </div>
    <p style="font-size:12px;color:#8a8175;margin-top:20px">Вы получили письмо, потому что указали этот адрес на Книгоманах.</p>
  </div></body></html>`;
}

function button(href, label) {
  return `<p style="margin:24px 0"><a href="${href}" style="background:#2f5d50;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;display:inline-block;font-weight:600">${label}</a></p>`;
}

async function sendVerifyEmail(user, link) {
  await sendMail({
    to: user.email,
    subject: 'Подтвердите адрес на Книгоманах',
    text: `Здравствуйте, ${user.name}! Подтвердите адрес: ${link}`,
    html: layout('Подтвердите адрес', `
      <p>Здравствуйте, ${user.name}!</p>
      <p>Осталось одно действие — подтвердить e-mail, чтобы мы могли присылать вам дайджесты и восстанавливать пароль.</p>
      ${button(link, 'Подтвердить адрес')}
      <p style="font-size:13px;color:#8a8175">Ссылка действует 48 часов.</p>`)
  });
}

async function sendResetEmail(user, link) {
  await sendMail({
    to: user.email,
    subject: 'Восстановление пароля на Книгоманах',
    text: `Сброс пароля: ${link}`,
    html: layout('Восстановление пароля', `
      <p>Здравствуйте, ${user.name}!</p>
      <p>Мы получили запрос на смену пароля. Ссылка действует один час.</p>
      ${button(link, 'Задать новый пароль')}
      <p style="font-size:13px;color:#8a8175">Если вы не запрашивали смену пароля, просто проигнорируйте письмо.</p>`)
  });
}

/**
 * Дайджест. HTML собирается в сервисе (src/services/digest.js), здесь только
 * обёртка: письмо должно выглядеть так же, как письма о пароле, иначе
 * человек не поймёт, что это от нас.
 */
async function sendDigestEmail({ to, subject, html, text }) {
  await sendMail({
    to,
    subject,
    text,
    html: layout(subject, html)
  });
}

module.exports = {
  sendMail,
  sendDigestEmail,
  layout,
  button,
  sendVerifyEmail,
  sendResetEmail,
  buildTransport,
  assertMailReady,
  get transportKind() {
    return getTransport().kind;
  }
};
