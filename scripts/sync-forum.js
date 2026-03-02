// scripts/sync-forum.js
const sequelize = require('../config/database');
const {
  ForumCategory,
  ForumTopic,
  ForumPost,
  ForumPostLike,
  ForumSubscription
} = require('../models');

async function syncForumTables() {
  try {
    console.log('🔄 Синхронизация таблиц форума...');
    
    await sequelize.sync({ alter: true });
    
    console.log('✅ Таблицы форума синхронизированы!');
    console.log('   - forum_categories');
    console.log('   - forum_topics');
    console.log('   - forum_posts');
    console.log('   - forum_post_likes');
    console.log('   - forum_subscriptions');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка:', error);
    process.exit(1);
  }
}

syncForumTables();