// scripts/delete-last-n-books.js
const { Book, Review, UserBook } = require('../models');
const fs = require('fs').promises;
const path = require('path');
const { Op } = require('sequelize');

async function deleteLastNBooks() {
  console.log('🔄 УДАЛЕНИЕ ПОСЛЕДНИХ N КНИГ\n');
  
  try {
    // Получаем количество из аргументов командной строки
    const n = parseInt(process.argv[2]) || 10;
    
    console.log(`📚 Будет удалено последних ${n} книг\n`);
    
    // Находим последние N книг
    const booksToDelete = await Book.findAll({
      order: [['createdAt', 'DESC']],
      limit: n
    });
    
    if (booksToDelete.length === 0) {
      console.log('❌ Нет книг для удаления');
      process.exit(0);
    }
    
    console.log(`📚 Найдено книг для удаления: ${booksToDelete.length}`);
    console.log('\nПоследние 5 книг:');
    booksToDelete.slice(0, 5).forEach((book, i) => {
      console.log(`   ${i+1}. ID: ${book.id} | ${book.title} | ${new Date(book.createdAt).toLocaleString()}`);
    });
    
    // Подтверждение через консоль (для безопасности)
    console.log('\n⚠️  Для подтверждения запустите скрипт с флагом --force');
    console.log('   Пример: node scripts/delete-last-n-books.js 10 --force');
    
    if (process.argv[3] !== '--force') {
      console.log('\n❌ Операция отменена (нужен флаг --force)');
      process.exit(0);
    }
    
    // Удаляем
    let deletedReviews = 0;
    let deletedUserBooks = 0;
    let deletedCovers = 0;
    
    for (const book of booksToDelete) {
      // Удаляем рецензии
      const reviews = await Review.destroy({ where: { book_id: book.id } });
      deletedReviews += reviews;
      
      // Удаляем записи на полках
      const userBooks = await UserBook.destroy({ where: { book_id: book.id } });
      deletedUserBooks += userBooks;
      
      // Удаляем обложку
      if (book.cover_image && 
          book.cover_image !== 'default-book-cover.jpg' && 
          book.cover_image !== 'default-book-cover.svg') {
        try {
          const coverPath = path.join(__dirname, '../public/images/covers', book.cover_image);
          await fs.unlink(coverPath);
          deletedCovers++;
        } catch (err) {
          // Игнорируем
        }
      }
      
      await book.destroy();
    }
    
    console.log('\n📊 ===== РЕЗУЛЬТАТ =====');
    console.log(`   ✅ Удалено книг: ${booksToDelete.length}`);
    console.log(`   ✅ Удалено рецензий: ${deletedReviews}`);
    console.log(`   ✅ Удалено записей на полках: ${deletedUserBooks}`);
    console.log(`   🗑️ Удалено обложек: ${deletedCovers}`);
    
  } catch (error) {
    console.error('❌ Ошибка:', error);
  } finally {
    process.exit(0);
  }
}

deleteLastNBooks();