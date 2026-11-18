'use strict';

/**
 * Одноразовые токены для подтверждения почты и сброса пароля.
 * Хранится только SHA-256 токена — см. src/models/Token.js.
 */
async function up(queryInterface, Sequelize, transaction) {
  const run = (sql) => queryInterface.sequelize.query(sql, { transaction });

  await run("CREATE TYPE token_type AS ENUM ('verify_email', 'reset_password')");
  await run(`CREATE TABLE user_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type token_type NOT NULL,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await run('CREATE INDEX user_tokens_user_idx ON user_tokens (user_id, type)');
  await run('CREATE INDEX user_tokens_expires_idx ON user_tokens (expires_at)');
}

async function down(queryInterface, Sequelize, transaction) {
  const run = (sql) => queryInterface.sequelize.query(sql, { transaction });
  await run('DROP TABLE IF EXISTS user_tokens CASCADE');
  await run('DROP TYPE IF EXISTS token_type CASCADE');
}

module.exports = { up, down };
