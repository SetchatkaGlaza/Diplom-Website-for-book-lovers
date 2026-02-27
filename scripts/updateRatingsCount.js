const { Book, Review } = require('../models');
const sequelize = require('../config/database');

async function updateAllRatings() {
  try {
    console.log('Начинаем обновление рейтингов книг...');
    
    const books = await Book.findAll();
    
    for (const book of books) {
      const reviews = await Review.count({
        where: {
          book_id: book.id,
          is_moderated: true
        }
      });
      
      await book.update({ ratings_count: reviews });
      console.log(`✅ Книга ID ${book.id}: ${reviews} оценок`);
    }
    
    console.log('🎉 Обновление завершено!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка:', error);
    process.exit(1);
  }
}

updateAllRatings();