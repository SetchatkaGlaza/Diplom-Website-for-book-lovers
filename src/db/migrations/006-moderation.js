'use strict';

/**
 * Журнал модерации: отдельная таблица вместо activities.
 *
 * Причина: журнал нельзя показывать в читательской ленте, а записи должны
 * переживать удаление аккаунта модератора (поэтому ON DELETE SET NULL).
 */
async function up(queryInterface) {
  const run = (sql) => queryInterface.sequelize.query(sql);

  await run(`
    CREATE TABLE IF NOT EXISTS moderation_log (
      id SERIAL PRIMARY KEY,
      actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action VARCHAR(60) NOT NULL,
      subject_type VARCHAR(30),
      subject_id INTEGER,
      note VARCHAR(500) NOT NULL DEFAULT '',
      meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

  await run('CREATE INDEX IF NOT EXISTS moderation_log_created_idx ON moderation_log (created_at DESC)');
  await run('CREATE INDEX IF NOT EXISTS moderation_log_subject_idx ON moderation_log (subject_type, subject_id)');
}

async function down(queryInterface) {
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS moderation_log');
}

module.exports = { up, down };
