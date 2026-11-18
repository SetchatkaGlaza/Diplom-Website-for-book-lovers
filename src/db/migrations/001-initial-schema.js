'use strict';

/**
 * Начальная схема Книгоманов 2.0 — явный SQL.
 *
 * Почему не queryInterface.createTable: Sequelize при создании таблицы с ENUM
 * выполняет собственный запрос вне транзакции, а в тестах пул равен одному
 * соединению (PGlite). В итоге миграция зависает. Явный SQL решает проблему
 * и заодно делает схему читаемой: видно каждое поле, индекс и ограничение.
 */

const ENUM_TYPES = {
  user_role: ['user', 'moderator', 'editor', 'admin'],
  shelf_status: ['want', 'reading', 'read', 'dnf'],
  review_state: ['published', 'pending', 'hidden'],
  simple_state: ['published', 'hidden'],
  club_member_role: ['member', 'lead'],
  activity_type: ['shelf', 'finished', 'review', 'club_join', 'club_post', 'follow'],
  report_subject: ['review', 'comment', 'club_post', 'user'],
  report_state: ['open', 'resolved', 'rejected']
};

const TABLES = [
  `CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(60) NOT NULL,
    email VARCHAR(254) NOT NULL UNIQUE,
    password_hash VARCHAR(120) NOT NULL,
    role user_role NOT NULL DEFAULT 'user',
    bio TEXT NOT NULL DEFAULT '',
    avatar VARCHAR(255) NOT NULL DEFAULT 'default-avatar.svg',
    trust_level INTEGER NOT NULL DEFAULT 0,
    is_blocked BOOLEAN NOT NULL DEFAULT false,
    blocked_until TIMESTAMPTZ,
    session_epoch INTEGER NOT NULL DEFAULT 0,
    email_verified_at TIMESTAMPTZ,
    last_active_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE genres (
    id SERIAL PRIMARY KEY,
    name VARCHAR(60) NOT NULL UNIQUE,
    slug VARCHAR(60) NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 100,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE books (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(255) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    author VARCHAR(160) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    year INTEGER,
    pages INTEGER,
    publisher VARCHAR(160),
    isbn VARCHAR(20),
    cover VARCHAR(255) NOT NULL DEFAULT 'default-cover.svg',
    ratings_count INTEGER NOT NULL DEFAULT 0,
    ratings_sum INTEGER NOT NULL DEFAULT 0,
    reviews_count INTEGER NOT NULL DEFAULT 0,
    shelves_count INTEGER NOT NULL DEFAULT 0,
    views_count INTEGER NOT NULL DEFAULT 0,
    is_published BOOLEAN NOT NULL DEFAULT true,
    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT books_pages_positive CHECK (pages IS NULL OR pages > 0),
    CONSTRAINT books_year_reasonable CHECK (year IS NULL OR (year > 0 AND year < 2100))
  )`,

  `CREATE TABLE book_genres (
    id SERIAL PRIMARY KEY,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    genre_id INTEGER NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE library_entries (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    status shelf_status NOT NULL DEFAULT 'want',
    progress_pages INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    reread_count INTEGER NOT NULL DEFAULT 0,
    is_favorite BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT library_progress_positive CHECK (progress_pages >= 0),
    CONSTRAINT library_reread_positive CHECK (reread_count >= 0)
  )`,

  `CREATE TABLE reviews (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    rating SMALLINT NOT NULL,
    title VARCHAR(160) NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    has_spoilers BOOLEAN NOT NULL DEFAULT false,
    state review_state NOT NULL DEFAULT 'published',
    likes_count INTEGER NOT NULL DEFAULT 0,
    comments_count INTEGER NOT NULL DEFAULT 0,
    moderation_note VARCHAR(255),
    moderated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT reviews_rating_half_step CHECK (rating >= 1 AND rating <= 10)
  )`,

  `CREATE TABLE review_likes (
    id SERIAL PRIMARY KEY,
    review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE review_comments (
    id SERIAL PRIMARY KEY,
    review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    state simple_state NOT NULL DEFAULT 'published',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE follows (
    id SERIAL PRIMARY KEY,
    follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT follows_not_self CHECK (follower_id <> following_id)
  )`,

  `CREATE TABLE clubs (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    cover VARCHAR(255) NOT NULL DEFAULT 'default-club.svg',
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_private BOOLEAN NOT NULL DEFAULT false,
    members_count INTEGER NOT NULL DEFAULT 1,
    posts_count INTEGER NOT NULL DEFAULT 0,
    current_book_id INTEGER REFERENCES books(id) ON DELETE SET NULL,
    last_activity_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE club_members (
    id SERIAL PRIMARY KEY,
    club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role club_member_role NOT NULL DEFAULT 'member',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE club_posts (
    id SERIAL PRIMARY KEY,
    club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    chapter INTEGER,
    has_spoilers BOOLEAN NOT NULL DEFAULT false,
    state simple_state NOT NULL DEFAULT 'published',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(40) NOT NULL,
    title VARCHAR(160) NOT NULL,
    body VARCHAR(500) NOT NULL DEFAULT '',
    url VARCHAR(255),
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE activities (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type activity_type NOT NULL,
    book_id INTEGER REFERENCES books(id) ON DELETE SET NULL,
    review_id INTEGER REFERENCES reviews(id) ON DELETE SET NULL,
    club_id INTEGER REFERENCES clubs(id) ON DELETE SET NULL,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE reading_goals (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    target_books INTEGER NOT NULL DEFAULT 12,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT goals_target_positive CHECK (target_books > 0)
  )`,

  `CREATE TABLE reports (
    id SERIAL PRIMARY KEY,
    reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_type report_subject NOT NULL,
    subject_id INTEGER NOT NULL,
    reason VARCHAR(500) NOT NULL,
    state report_state NOT NULL DEFAULT 'open',
    resolved_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    resolution_note VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE conversations (
    id SERIAL PRIMARY KEY,
    user_a_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_message_at TIMESTAMPTZ,
    last_message_preview VARCHAR(160) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT conversations_order CHECK (user_a_id < user_b_id)
  )`,

  `CREATE TABLE messages (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    read_at TIMESTAMPTZ,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // Сессиями пользуется connect-pg-simple; структура должна совпадать
  `CREATE TABLE user_sessions (
    sid VARCHAR NOT NULL PRIMARY KEY,
    sess JSON NOT NULL,
    expire TIMESTAMP(6) NOT NULL
  )`
];

const INDEXES = [
  'CREATE INDEX users_role_idx ON users (role)',
  'CREATE INDEX users_last_active_idx ON users (last_active_at)',
  'CREATE INDEX books_author_idx ON books (author)',
  'CREATE INDEX books_title_idx ON books (title)',
  'CREATE INDEX books_year_idx ON books (year)',
  'CREATE INDEX books_ratings_idx ON books (ratings_count)',
  'CREATE INDEX books_shelves_idx ON books (shelves_count)',
  'CREATE INDEX books_published_idx ON books (is_published, created_at DESC)',
  'CREATE UNIQUE INDEX book_genres_unique_idx ON book_genres (book_id, genre_id)',
  'CREATE INDEX book_genres_genre_idx ON book_genres (genre_id)',
  'CREATE UNIQUE INDEX library_user_book_idx ON library_entries (user_id, book_id)',
  'CREATE INDEX library_user_status_idx ON library_entries (user_id, status)',
  'CREATE INDEX library_book_status_idx ON library_entries (book_id, status)',
  'CREATE INDEX library_user_finished_idx ON library_entries (user_id, finished_at DESC)',
  'CREATE UNIQUE INDEX reviews_user_book_idx ON reviews (user_id, book_id)',
  'CREATE INDEX reviews_book_state_idx ON reviews (book_id, state, created_at DESC)',
  'CREATE INDEX reviews_user_created_idx ON reviews (user_id, created_at DESC)',
  'CREATE INDEX reviews_state_created_idx ON reviews (state, created_at DESC)',
  'CREATE UNIQUE INDEX review_likes_unique_idx ON review_likes (review_id, user_id)',
  'CREATE INDEX review_comments_review_idx ON review_comments (review_id, created_at)',
  'CREATE INDEX review_comments_user_idx ON review_comments (user_id)',
  'CREATE UNIQUE INDEX follows_unique_idx ON follows (follower_id, following_id)',
  'CREATE INDEX follows_following_idx ON follows (following_id, created_at DESC)',
  'CREATE INDEX clubs_owner_idx ON clubs (owner_id)',
  'CREATE INDEX clubs_members_idx ON clubs (members_count DESC)',
  'CREATE INDEX clubs_activity_idx ON clubs (last_activity_at DESC)',
  'CREATE UNIQUE INDEX club_members_unique_idx ON club_members (club_id, user_id)',
  'CREATE INDEX club_members_user_idx ON club_members (user_id)',
  'CREATE INDEX club_posts_club_idx ON club_posts (club_id, created_at DESC)',
  'CREATE INDEX club_posts_user_idx ON club_posts (user_id)',
  'CREATE INDEX notifications_user_idx ON notifications (user_id, is_read, created_at DESC)',
  'CREATE INDEX activities_user_idx ON activities (user_id, created_at DESC)',
  'CREATE INDEX activities_created_idx ON activities (created_at DESC)',
  'CREATE UNIQUE INDEX goals_user_year_idx ON reading_goals (user_id, year)',
  'CREATE INDEX reports_state_idx ON reports (state, created_at DESC)',
  'CREATE INDEX reports_subject_idx ON reports (subject_type, subject_id)',
  'CREATE UNIQUE INDEX conversations_pair_idx ON conversations (user_a_id, user_b_id)',
  'CREATE INDEX conversations_last_idx ON conversations (last_message_at DESC)',
  'CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at DESC)',
  'CREATE INDEX messages_sender_idx ON messages (sender_id)',
  'CREATE INDEX user_sessions_expire_idx ON user_sessions (expire)'
];

async function up(queryInterface, Sequelize, transaction) {
  const run = (sql) => queryInterface.sequelize.query(sql, { transaction });

  for (const [name, values] of Object.entries(ENUM_TYPES)) {
    await run(`DROP TYPE IF EXISTS ${name} CASCADE`);
    await run(`CREATE TYPE ${name} AS ENUM (${values.map((v) => `'${v}'`).join(', ')})`);
  }

  for (const sql of TABLES) await run(sql);
  for (const sql of INDEXES) await run(sql);
}

async function down(queryInterface, Sequelize, transaction) {
  const run = (sql) => queryInterface.sequelize.query(sql, { transaction });

  const tables = [
    'messages', 'conversations', 'reports', 'reading_goals', 'activities',
    'notifications', 'club_posts', 'club_members', 'clubs', 'follows',
    'review_comments', 'review_likes', 'reviews', 'library_entries',
    'book_genres', 'books', 'genres', 'users', 'user_sessions'
  ];

  for (const table of tables) await run(`DROP TABLE IF EXISTS ${table} CASCADE`);
  for (const name of Object.keys(ENUM_TYPES)) await run(`DROP TYPE IF EXISTS ${name} CASCADE`);
}

module.exports = { up, down, ENUM_TYPES };
