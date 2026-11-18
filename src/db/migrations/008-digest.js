'use strict';

/**
 * Дайджесты и отписка от писем.
 *
 * Три вещи, которых не было:
 *  - `users.notify_digest` — согласие на письма. По умолчанию выключено:
 *    рассылка по умолчанию — это спам, даже если письмо полезное.
 *    Первое письмо всё равно попросит подтвердить адрес;
 *  - `digests` — журнал отправленных писем. Нужен, чтобы не отправить
 *    человеку два письма за неделю и чтобы было видно, сработала ли
 *    рассылка вообще (без таблицы это «кажется, отправили»);
 *  - `email_unsubscribes` — отписка по ссылке из письма. Храним не id
 *    пользователя, а хеш адреса: отписаться можно без входа в аккаунт,
 *    а ссылка из письма не должна позволять перебирать чужие адреса.
 */
async function up(queryInterface) {
  const run = (sql) => queryInterface.sequelize.query(sql);

  await run('ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_digest BOOLEAN NOT NULL DEFAULT false');

  await run(`
    CREATE TABLE IF NOT EXISTS digests (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind VARCHAR(20) NOT NULL DEFAULT 'weekly',
      period_start TIMESTAMPTZ,
      period_end TIMESTAMPTZ,
      sent_at TIMESTAMPTZ,
      opened_at TIMESTAMPTZ,
      status VARCHAR(20) NOT NULL DEFAULT 'queued',
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

  // Один дайджест на человека за период: повторный запуск не должен
  // отправлять второе письмо о той же неделе
  await run('CREATE UNIQUE INDEX IF NOT EXISTS digests_user_period_idx ON digests (user_id, kind, period_start)');
  await run('CREATE INDEX IF NOT EXISTS digests_status_idx ON digests (status, created_at DESC)');

  await run(`
    CREATE TABLE IF NOT EXISTS email_unsubscribes (
      id SERIAL PRIMARY KEY,
      email_hash VARCHAR(64) NOT NULL UNIQUE,
      kind VARCHAR(20) NOT NULL DEFAULT 'all',
      reason VARCHAR(200) NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
}

async function down(queryInterface) {
  const run = (sql) => queryInterface.sequelize.query(sql);
  await run('DROP TABLE IF EXISTS email_unsubscribes CASCADE');
  await run('DROP TABLE IF EXISTS digests CASCADE');
  await run('ALTER TABLE users DROP COLUMN IF EXISTS notify_digest');
}

module.exports = { up, down };
