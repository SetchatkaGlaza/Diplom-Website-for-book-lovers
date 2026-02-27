const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { Book, Genre } = require('../models');
const notificationService = require('../services/notificationService');

/**
 * Страница импорта книг
 */
exports.getImportPage = async (req, res) => {
  try {
    const genres = await Genre.findAll({ order: [['name', 'ASC']] });
    
    res.render('admin/import', {
      title: 'Импорт книг',
      genres,
      layout: 'layouts/admin'
    });
    
  } catch (error) {
    console.error('Ошибка при загрузке страницы импорта:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/admin/books');
  }
};

/**
 * Обработка импорта из CSV
 */
exports.importBooks = async (req, res) => {
  try {
    if (!req.file) {
      req.flash('error', 'Пожалуйста, выберите файл');
      return res.redirect('/admin/import');
    }
    
    const filePath = req.file.path;
    const results = [];
    const errors = [];
    const skipped = [];
    
    // Определяем тип файла по расширению
    const ext = path.extname(req.file.originalname).toLowerCase();
    
    if (ext === '.csv') {
      // Парсим CSV
      await new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
          .pipe(csv({
            separator: req.body.delimiter || ',',
            headers: true
          }))
          .on('data', (data) => results.push(data))
          .on('end', resolve)
          .on('error', reject);
      });
    } else if (ext === '.json') {
      // Парсим JSON
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const jsonData = JSON.parse(fileContent);
      
      if (Array.isArray(jsonData)) {
        results.push(...jsonData);
      } else if (jsonData.books && Array.isArray(jsonData.books)) {
        results.push(...jsonData.books);
      } else {
        throw new Error('Неверный формат JSON. Ожидается массив книг');
      }
    } else {
      throw new Error('Неподдерживаемый формат файла. Используйте CSV или JSON');
    }
    
    // Статистика импорта
    const stats = {
      total: results.length,
      success: 0,
      errors: 0,
      skipped: 0,
      details: []
    };
    
    // Обрабатываем каждую книгу
    for (let i = 0; i < results.length; i++) {
      const row = results[i];
      const bookData = {};
      const rowErrors = [];
      
      try {
        // Маппинг полей (можно настроить через форму)
        const mapping = {
          title: req.body.field_title || 'title',
          author: req.body.field_author || 'author',
          description: req.body.field_description || 'description',
          year: req.body.field_year || 'year',
          pages: req.body.field_pages || 'pages',
          publisher: req.body.field_publisher || 'publisher',
          isbn: req.body.field_isbn || 'isbn',
          genre: req.body.field_genre || 'genre'
        };
        
        // Проверяем обязательные поля
        if (!row[mapping.title]) {
          rowErrors.push('Отсутствует название');
        } else {
          bookData.title = row[mapping.title].trim();
        }
        
        if (!row[mapping.author]) {
          rowErrors.push('Отсутствует автор');
        } else {
          bookData.author = row[mapping.author].trim();
        }
        
        // Опциональные поля
        if (row[mapping.description]) {
          bookData.description = row[mapping.description].trim();
        }
        
        if (row[mapping.year]) {
          const year = parseInt(row[mapping.year]);
          if (!isNaN(year) && year > 1000 && year < 2100) {
            bookData.year = year;
          } else {
            rowErrors.push('Некорректный год');
          }
        }
        
        if (row[mapping.pages]) {
          const pages = parseInt(row[mapping.pages]);
          if (!isNaN(pages) && pages > 0) {
            bookData.pages = pages;
          } else {
            rowErrors.push('Некорректное количество страниц');
          }
        }
        
        if (row[mapping.publisher]) {
          bookData.publisher = row[mapping.publisher].trim();
        }
        
        if (row[mapping.isbn]) {
          bookData.isbn = row[mapping.isbn].trim();
        }
        
        // Обработка жанра
        if (row[mapping.genre] && req.body.default_genre) {
          // Используем жанр из файла или дефолтный
          const genreName = row[mapping.genre].trim();
          let genre = await Genre.findOne({ where: { name: genreName } });
          
          if (!genre) {
            if (req.body.create_genres === 'on') {
              // Создаём новый жанр
              genre = await Genre.create({ name: genreName });
            } else {
              // Используем дефолтный
              genre = await Genre.findByPk(req.body.default_genre);
            }
          }
          
          if (genre) {
            bookData.genre_id = genre.id;
          }
        } else if (req.body.default_genre) {
          bookData.genre_id = req.body.default_genre;
        }
        
        // Проверяем дубликаты (по названию и автору)
        if (req.body.skip_duplicates === 'on') {
          const existing = await Book.findOne({
            where: {
              title: bookData.title,
              author: bookData.author
            }
          });
          
          if (existing) {
            skipped.push({ row: i + 1, title: bookData.title, reason: 'дубликат' });
            stats.skipped++;
            continue;
          }
        }
        
        // Если есть ошибки, пропускаем
        if (rowErrors.length > 0) {
          errors.push({ row: i + 1, errors: rowErrors, data: bookData });
          stats.errors++;
          stats.details.push({ row: i + 1, success: false, errors: rowErrors });
          continue;
        }
        
        // Создаём книгу
        await Book.create({
          ...bookData,
          cover_image: 'default-book-cover.jpg',
          views_count: 0
        });
        
        stats.success++;
        stats.details.push({ row: i + 1, success: true });
        
      } catch (error) {
        console.error(`Ошибка при обработке строки ${i + 1}:`, error);
        errors.push({ row: i + 1, error: error.message });
        stats.errors++;
        stats.details.push({ row: i + 1, success: false, error: error.message });
      }
    }
    
    // Удаляем временный файл
    fs.unlinkSync(filePath);
    
    

    // Отправляем уведомление администратору
    await notificationService.booksImported(req.session.user.id, stats);
    
    // Сохраняем результат в сессии для отображения
    req.session.importResult = stats;
    
    req.flash('success', `Импорт завершён. Добавлено: ${stats.success}, ошибок: ${stats.errors}, пропущено: ${stats.skipped}`);
    res.redirect('/admin/import/result');
    
  } catch (error) {
    console.error('Ошибка при импорте:', error);
    
    // Удаляем временный файл в случае ошибки
    if (req.file && req.file.path) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
    
    req.flash('error', 'Ошибка при импорте: ' + error.message);
    res.redirect('/admin/import');
  }
};

/**
 * Показать результат импорта
 */
exports.showImportResult = async (req, res) => {
  try {
    const result = req.session.importResult || null;
    delete req.session.importResult;
    
    res.render('admin/import-result', {
      title: 'Результат импорта',
      result,
      layout: 'layouts/admin'
    });
    
  } catch (error) {
    console.error('Ошибка при показе результата:', error);
    res.redirect('/admin/books');
  }
};

/**
 * Скачать шаблон для импорта
 */
exports.downloadTemplate = (req, res) => {
  try {
    const type = req.query.type || 'csv';
    
    if (type === 'csv') {
      // Создаём CSV шаблон
      const headers = ['title', 'author', 'description', 'year', 'pages', 'publisher', 'isbn', 'genre'];
      const sample = ['Война и мир', 'Лев Толстой', 'Великий роман...', '1869', '1300', 'АСТ', '978-5-17-123456-7', 'Роман'];
      
      const csv = headers.join(',') + '\n' + sample.join(',');
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=books_template.csv');
      res.send(csv);
      
    } else if (type === 'json') {
      // Создаём JSON шаблон
      const template = {
        books: [
          {
            title: 'Война и мир',
            author: 'Лев Толстой',
            description: 'Великий роман...',
            year: 1869,
            pages: 1300,
            publisher: 'АСТ',
            isbn: '978-5-17-123456-7',
            genre: 'Роман'
          }
        ]
      };
      
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename=books_template.json');
      res.send(JSON.stringify(template, null, 2));
    }
    
  } catch (error) {
    console.error('Ошибка при скачивании шаблона:', error);
    res.redirect('/admin/import');
  }
};