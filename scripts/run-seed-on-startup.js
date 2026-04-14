const sequelize = require('../config/database');
const bcrypt = require('bcrypt');
const { User, Genre, Book, Review, UserBook, ForumCategory, ForumTopic, ForumPost } = require('../models');

const SALT_ROUNDS = 10;

async function seed() {
  try {
    console.log('🌱 ПРОВЕРКА И ЗАПОЛНЕНИЕ БАЗЫ ДАННЫХ...');
    
    // Проверяем, есть ли уже администратор
    const adminExists = await User.findOne({ where: { email: 'admin@booklovers.ru' } });
    
    if (adminExists) {
      console.log('✅ База данных уже заполнена, пропускаем сид');
      return;
    }
    
    console.log('📝 База данных пуста, начинаем заполнение...');
    
    // ===== СОЗДАЁМ ПОЛЬЗОВАТЕЛЕЙ =====
    const adminPassword = await bcrypt.hash('admin123', SALT_ROUNDS);
    const userPassword = await bcrypt.hash('user123', SALT_ROUNDS);
    
    const users = await User.bulkCreate([
      { name: 'Администратор', email: 'admin@booklovers.ru', password_hash: adminPassword, role: 'admin', avatar: 'default-avatar.png', isBlocked: false, email_verified: true },
      { name: 'Иван Петров', email: 'ivan@example.com', password_hash: userPassword, role: 'user', avatar: 'default-avatar.png', isBlocked: false, email_verified: true },
      { name: 'Мария Сидорова', email: 'maria@example.com', password_hash: userPassword, role: 'user', avatar: 'default-avatar.png', isBlocked: false, email_verified: true },
      { name: 'Алексей Книголюбов', email: 'alex@example.com', password_hash: userPassword, role: 'moderator', avatar: 'default-avatar.png', isBlocked: false, email_verified: true }
    ]);
    console.log(`✅ Создано пользователей: ${users.length}`);
    
    // ===== СОЗДАЁМ ЖАНРЫ =====
    const genres = await Genre.bulkCreate([
      { name: 'Фэнтези' }, { name: 'Научная фантастика' }, { name: 'Детектив' },
      { name: 'Роман' }, { name: 'Приключения' }, { name: 'Ужасы' },
      { name: 'Классика' }, { name: 'Триллер' }
    ]);
    console.log(`✅ Создано жанров: ${genres.length}`);
    
    // ===== СОЗДАЁМ КНИГИ =====
    const books = await Book.bulkCreate([
      { title: 'Властелин Колец', author: 'Дж.Р.Р. Толкин', description: 'Эпическая фэнтези-сага', year: 1954, pages: 540, publisher: 'АСТ', cover_image: 'lotr1.jpg', genre_id: genres[0].id, views_count: 15000 },
      { title: '1984', author: 'Джордж Оруэлл', description: 'Классическая антиутопия', year: 1949, pages: 320, publisher: 'Эксмо', cover_image: '1984.jpg', genre_id: genres[1].id, views_count: 28000 },
      { title: 'Мастер и Маргарита', author: 'Михаил Булгаков', description: 'Мистический роман', year: 1967, pages: 480, publisher: 'АСТ', cover_image: 'master.jpg', genre_id: genres[3].id, views_count: 32000 }
    ]);
    console.log(`✅ Создано книг: ${books.length}`);
    
    // ===== СОЗДАЁМ КАТЕГОРИИ ФОРУМА =====
    await ForumCategory.bulkCreate([
      { name: 'Общие обсуждения', description: 'Любые темы о книгах', icon: 'fa-comments', sort_order: 1, created_by: users[0].id, is_active: true },
      { name: 'Книжные рекомендации', description: 'Советуйте книги', icon: 'fa-bookmark', sort_order: 2, created_by: users[0].id, is_active: true },
      { name: 'Помощь и поддержка', description: 'Вопросы по сайту', icon: 'fa-life-ring', sort_order: 3, created_by: users[0].id, is_active: true }
    ]);
    console.log('✅ Созданы категории форума');
    
    console.log('🎉 БАЗА ДАННЫХ УСПЕШНО ЗАПОЛНЕНА!');
    console.log('📝 Администратор: admin@booklovers.ru / admin123');
    
  } catch (error) {
    console.error('❌ Ошибка:', error);
  }
}

// Запускаем сид
seed();