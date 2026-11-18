'use strict';

/**
 * Поля для аутентификации и удаления аккаунта:
 *  - registration_ip: защита от массовых регистраций с одного адреса;
 *  - deleted_at: мягкое удаление (строка остаётся обезличенной,
 *    чтобы не ломать чужие комментарии и рецензии).
 */
async function up(queryInterface, Sequelize, transaction) {
  const run = (sql) => queryInterface.sequelize.query(sql, { transaction });
  await run('ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_ip VARCHAR(45)');
  await run('ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ');
  await run('CREATE INDEX IF NOT EXISTS users_deleted_idx ON users (deleted_at)');
}

async function down(queryInterface, Sequelize, transaction) {
  const run = (sql) => queryInterface.sequelize.query(sql, { transaction });
  await run('DROP INDEX IF EXISTS users_deleted_idx');
  await run('ALTER TABLE users DROP COLUMN IF EXISTS deleted_at');
  await run('ALTER TABLE users DROP COLUMN IF EXISTS registration_ip');
}

module.exports = { up, down };
