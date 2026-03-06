// scripts/reset-db.js
const sequelize = require('../config/database');
const { User, Genre, Book, Review, UserBook, ReviewLike, PasswordReset, LoginAttempt, Notification, ForumCategory, ForumTopic, ForumPost, ForumPostLike, ForumSubscription } = require('../models');

async function resetDatabase() {
  try {
    console.log('🔄 Сбрасываем базу данных...');
    
    // Удаляем все таблицы в правильном порядке
    await sequelize.query('DROP TABLE IF EXISTS "ForumPostLikes" CASCADE;');
    await sequelize.query('DROP TABLE IF EXISTS "ForumSubscriptions" CASCADE;');
    await sequelize.query('DROP TABLE IF EXISTS "ForumPosts" CASCADE;');
    await sequelize.query('DROP TABLE IF EXISTS "ForumTopics" CASCADE;');
    await sequelize.query('DROP TABLE IF EXISTS "ForumCategories" CASCADE;');
    await sequelize.query('DROP TABLE IF EXISTS "Notifications" CASCADE;');
    await sequelize.query('DROP TABLE IF EXISTS "LoginAttempts" CASCADE;');
    await sequelize.query('DROP TABLE IF EXISTS "PasswordResets" CASCADE;');
    await sequelize.query('DROP TABLE IF EXISTS "ReviewLikes" CASCADE;');
    await sequelize.query('DROP TABLE IF EXISTS "UserBooks" CASCADE;');
    await sequelize.query('DROP TABLE IF EXISTS "Reviews" CASCADE;');
    await sequelize.query('DROP TABLE IF EXISTS "Books" CASCADE;');
    await sequelize.query('DROP TABLE IF EXISTS "Genres" CASCADE;');
    await sequelize.query('DROP TABLE IF EXISTS "Users" CASCADE;');
    
    console.log('✅ Таблицы удалены');
    
    // Создаём заново
    await sequelize.sync({ force: true });
    console.log('✅ Таблицы созданы заново');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка:', error);
    process.exit(1);
  }
}

resetDatabase();