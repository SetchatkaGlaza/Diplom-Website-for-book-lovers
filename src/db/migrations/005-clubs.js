'use strict';

/**
 * Клубы: заявки, приглашения и расписание по главам.
 *
 * Роли расширены в начальной схеме: member / moderator / owner, старое `lead`
 * осталось для совместимости. Отдельная миграция нужна только под новые таблицы.
 */

async function up(queryInterface) {
  const sequelize = queryInterface.sequelize;

  // Роли: owner и moderator появились вместе с клубами. Добавляем значения в enum;
  // миграции идут без транзакций (useTransactions: false), поэтому это допустимо.
  for (const value of ['moderator', 'owner']) {
    await sequelize.query(`ALTER TYPE club_member_role ADD VALUE IF NOT EXISTS '${value}'`);
  }

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS club_requests (
      id SERIAL PRIMARY KEY,
      club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message VARCHAR(300) NOT NULL DEFAULT '',
      state VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

  await sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS club_requests_pending_idx
      ON club_requests (club_id, user_id) WHERE state = 'pending'`);

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS club_invites (
      id SERIAL PRIMARY KEY,
      club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      code VARCHAR(64) NOT NULL UNIQUE,
      created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      max_uses INTEGER NOT NULL DEFAULT 1,
      uses_count INTEGER NOT NULL DEFAULT 0,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS club_schedule (
      id SERIAL PRIMARY KEY,
      club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      chapter INTEGER NOT NULL,
      discussion_on DATE NOT NULL,
      note VARCHAR(300) NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

  await sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS club_schedule_chapter_idx
      ON club_schedule (club_id, chapter)`);

  await sequelize.query('CREATE INDEX IF NOT EXISTS club_posts_chapter_idx ON club_posts (club_id, chapter)');
}

async function down(queryInterface) {
  const sequelize = queryInterface.sequelize;
  await sequelize.query('DROP TABLE IF EXISTS club_schedule');
  await sequelize.query('DROP TABLE IF EXISTS club_invites');
  await sequelize.query('DROP TABLE IF EXISTS club_requests');
  // Значения ENUM в PostgreSQL удалить нельзя без пересоздания типа — оставляем.
}

module.exports = { up, down };
