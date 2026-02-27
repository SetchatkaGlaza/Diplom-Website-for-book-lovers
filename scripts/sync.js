const sequelize = require('../config/database');
const { User, Genre, Book, Review, UserBook, ReviewLike, PasswordReset, LoginAttempt } = require('../models');

async function syncDatabase() {
  try {
    console.log('🔄 Начинаем синхронизацию базы данных...');
    
    // Синхронизируем все модели (force: true удалит и создаст заново)
    await sequelize.sync({ alter: true });
    
    console.log('✅ База данных успешно синхронизирована!');
    console.log('   Созданы таблицы:');
    console.log('   - Users');
    console.log('   - Genres');
    console.log('   - Books');
    console.log('   - Reviews');
    console.log('   - UserBooks');
    console.log('   - ReviewLikes');
    console.log('   - PasswordResets');
    console.log('   - LoginAttempts');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка при синхронизации:', error);
    process.exit(1);
  }
}

syncDatabase();