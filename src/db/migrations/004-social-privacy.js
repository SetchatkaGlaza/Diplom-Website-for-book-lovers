'use strict';

/**
 * Социальная часть: приватность профиля, настройки уведомлений и цитаты.
 *
 *  - is_private — полку видно только подписчикам;
 *  - notify_* — по каким событиям присылать уведомления (в интерфейсе);
 *  - quotes — короткие цитаты из книг (до 300 знаков), со ссылкой на автора
 *    цитаты и на книгу. Полные тексты не храним: это защита по ст. 1274 ГК.
 */
async function up(queryInterface, Sequelize, transaction) {
  const run = (sql) => queryInterface.sequelize.query(sql, { transaction });

  await run('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT false');
  await run("ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_follows BOOLEAN NOT NULL DEFAULT true");
  await run("ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_comments BOOLEAN NOT NULL DEFAULT true");
  await run("ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_likes BOOLEAN NOT NULL DEFAULT true");
  await run("ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_messages BOOLEAN NOT NULL DEFAULT true");

  await run(`
    CREATE TABLE IF NOT EXISTS quotes (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      body VARCHAR(300) NOT NULL,
      page INTEGER,
      likes_count INTEGER NOT NULL DEFAULT 0,
      state VARCHAR(10) NOT NULL DEFAULT 'published',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Цитата не должна повторяться у одного человека на одной книге дважды подряд
  await run('CREATE INDEX IF NOT EXISTS quotes_book_idx ON quotes (book_id, created_at DESC)');
  await run('CREATE INDEX IF NOT EXISTS quotes_user_idx ON quotes (user_id, created_at DESC)');
  await run('CREATE INDEX IF NOT EXISTS messages_unread_idx ON messages (conversation_id, read_at)');
}

async function down(queryInterface, Sequelize, transaction) {
  const run = (sql) => queryInterface.sequelize.query(sql, { transaction });
  await run('DROP TABLE IF EXISTS quotes');
  await run('DROP INDEX IF EXISTS messages_unread_idx');
  for (const column of ['notify_messages', 'notify_likes', 'notify_comments', 'notify_follows', 'is_private']) {
    await run(`ALTER TABLE users DROP COLUMN IF EXISTS ${column}`);
  }
}

module.exports = { up, down };
