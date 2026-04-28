const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { Book, Genre } = require('../models');
const notificationService = require('../services/notificationService');
const { Op } = require('sequelize');

const DEBUG_IMPORT = process.env.DEBUG_IMPORT === 'true';
const debugLog = (...args) => {
  if (DEBUG_IMPORT) console.log(...args);
};

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
 * Обработка импорта из JSON файла
 */
async function processJsonFile(filePath) {
  const fileContent = fs.readFileSync(filePath, 'utf8');
  const jsonData = JSON.parse(fileContent);
  
  // Поддерживаем разные форматы JSON
  if (Array.isArray(jsonData)) {
    return jsonData;
  } else if (jsonData.books && Array.isArray(jsonData.books)) {
    return jsonData.books;
  } else {
    throw new Error('Неверный формат JSON. Ожидается массив книг или объект с полем "books"');
  }
}

/**
 * Обработка импорта из CSV файла
 */
async function processCsvFile(filePath, delimiter) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv({
        separator: delimiter || ',',
        mapHeaders: ({ header }) => header.trim().toLowerCase(),
        mapValues: ({ value }) => value.trim()
      }))
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', reject);
  });
}

/**
 * Получение ID жанра по названию
 */
async function getGenreId(genreName, createIfNotExists = false, defaultGenreId = null) {
  if (!genreName || genreName.trim() === '') {
    return defaultGenreId;
  }
  
  const cleanName = genreName.trim();
  debugLog(`   🔍 Поиск жанра: "${cleanName}"`);
  
  // Ищем точное совпадение (регистронезависимо)
  const genre = await Genre.findOne({
    where: {
      name: {
        [Op.iLike]: cleanName
      }
    }
  });
  
  if (genre) {
    debugLog(`   ✅ Жанр найден: ${genre.name} (ID: ${genre.id})`);
    return genre.id;
  }
  
  // Если жанр не найден и разрешено создавать
  if (createIfNotExists) {
    debugLog(`   ➕ Создаём новый жанр: "${cleanName}"`);
    const newGenre = await Genre.create({ 
      name: cleanName,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    debugLog(`   ✅ Создан жанр ID: ${newGenre.id}`);
    return newGenre.id;
  }
  
  debugLog(`   ❌ Жанр не найден и создание запрещено`);
  return defaultGenreId;
}

/**
 * Импорт книг
 */
exports.importBooks = async (req, res) => {
  try {
    if (!req.file) {
      req.flash('error', 'Пожалуйста, выберите файл');
      return res.redirect('/admin/import');
    }
    
    const filePath = req.file.path;
    let results = [];
    
    debugLog('\n📁 ===== НАЧАЛО ИМПОРТА =====');
    debugLog(`📁 Файл: ${req.file.originalname}`);
    debugLog(`📁 Размер: ${req.file.size} байт`);
    
    // Определяем тип файла
    const ext = path.extname(req.file.originalname).toLowerCase();
    debugLog(`📁 Расширение: ${ext}`);
    
    try {
      if (ext === '.json') {
        results = await processJsonFile(filePath);
      } else if (ext === '.csv') {
        results = await processCsvFile(filePath, req.body.delimiter);
      } else {
        throw new Error('Неподдерживаемый формат файла. Используйте CSV или JSON');
      }
    } catch (parseError) {
      console.error('❌ Ошибка парсинга файла:', parseError);
      fs.unlinkSync(filePath);
      req.flash('error', 'Ошибка при чтении файла: ' + parseError.message);
      return res.redirect('/admin/import');
    }
    
    debugLog(`📊 Найдено записей: ${results.length}`);
    
    if (results.length === 0) {
      fs.unlinkSync(filePath);
      req.flash('error', 'Файл не содержит данных');
      return res.redirect('/admin/import');
    }
    
    // Показываем первую запись для примера
    debugLog('\n📝 Пример первой записи:');
    debugLog(JSON.stringify(results[0], null, 2));
    
    // Получаем настройки из формы
    const fieldMapping = {
      title: req.body.field_title || 'title',
      author: req.body.field_author || 'author',
      description: req.body.field_description || 'description',
      year: req.body.field_year || 'year',
      pages: req.body.field_pages || 'pages',
      publisher: req.body.field_publisher || 'publisher',
      isbn: req.body.field_isbn || 'isbn',
      genre: req.body.field_genre || 'genre'
    };
    
    const createGenres = req.body.create_genres === 'on';
    const skipDuplicates = req.body.skip_duplicates === 'on';
    const defaultGenreId = req.body.default_genre || null;
    
    debugLog('\n⚙️ Настройки импорта:');
    debugLog(`   - Маппинг полей:`, fieldMapping);
    debugLog(`   - Создавать жанры: ${createGenres}`);
    debugLog(`   - Пропускать дубликаты: ${skipDuplicates}`);
    debugLog(`   - Жанр по умолчанию ID: ${defaultGenreId}`);
    
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
      
      debugLog(`\n📖 [${i + 1}/${results.length}] Обработка записи...`);
      
      try {
        // === НАЗВАНИЕ (обязательное) ===
        const titleKey = fieldMapping.title.toLowerCase();
        const titleValue = row[titleKey] || row[Object.keys(row).find(k => k.toLowerCase() === titleKey)];
        
        if (!titleValue) {
          rowErrors.push('Отсутствует название');
          debugLog(`   ❌ Нет названия`);
        } else {
          bookData.title = titleValue.toString().trim();
          debugLog(`   ✅ Название: ${bookData.title.substring(0, 50)}${bookData.title.length > 50 ? '...' : ''}`);
        }
        
        // === АВТОР (обязательное) ===
        const authorKey = fieldMapping.author.toLowerCase();
        const authorValue = row[authorKey] || row[Object.keys(row).find(k => k.toLowerCase() === authorKey)];
        
        if (!authorValue) {
          rowErrors.push('Отсутствует автор');
          debugLog(`   ❌ Нет автора`);
        } else {
          bookData.author = authorValue.toString().trim();
          debugLog(`   ✅ Автор: ${bookData.author.substring(0, 30)}${bookData.author.length > 30 ? '...' : ''}`);
        }
        
        // === ОПИСАНИЕ ===
        const descKey = fieldMapping.description.toLowerCase();
        const descValue = row[descKey] || row[Object.keys(row).find(k => k.toLowerCase() === descKey)];
        if (descValue) {
          bookData.description = descValue.toString().trim();
        }
        
        // === ГОД ===
        const yearKey = fieldMapping.year.toLowerCase();
        const yearValue = row[yearKey] || row[Object.keys(row).find(k => k.toLowerCase() === yearKey)];
        if (yearValue) {
          const year = parseInt(yearValue);
          if (!isNaN(year) && year > 1000 && year < 2100) {
            bookData.year = year;
          } else {
            rowErrors.push(`Некорректный год: ${yearValue}`);
          }
        }
        
        // === СТРАНИЦЫ ===
        const pagesKey = fieldMapping.pages.toLowerCase();
        const pagesValue = row[pagesKey] || row[Object.keys(row).find(k => k.toLowerCase() === pagesKey)];
        if (pagesValue) {
          const pages = parseInt(pagesValue);
          if (!isNaN(pages) && pages > 0) {
            bookData.pages = pages;
          } else {
            rowErrors.push(`Некорректное количество страниц: ${pagesValue}`);
          }
        }
        
        // === ИЗДАТЕЛЬСТВО ===
        const publisherKey = fieldMapping.publisher.toLowerCase();
        const publisherValue = row[publisherKey] || row[Object.keys(row).find(k => k.toLowerCase() === publisherKey)];
        if (publisherValue) {
          bookData.publisher = publisherValue.toString().trim();
        }
        
        // === ISBN ===
        const isbnKey = fieldMapping.isbn.toLowerCase();
        const isbnValue = row[isbnKey] || row[Object.keys(row).find(k => k.toLowerCase() === isbnKey)];
        if (isbnValue) {
          bookData.isbn = isbnValue.toString().trim();
        }
        
        // === ЖАНР (САМОЕ ВАЖНОЕ) ===
        const genreKey = fieldMapping.genre.toLowerCase();
        const genreValue = row[genreKey] || row[Object.keys(row).find(k => k.toLowerCase() === genreKey)];
        
        if (genreValue) {
          debugLog(`   🏷️ Значение жанра из файла: "${genreValue}"`);
          const genreId = await getGenreId(genreValue, createGenres, defaultGenreId);
          if (genreId) {
            bookData.genre_id = genreId;
            debugLog(`   ✅ Жанр установлен: ID ${genreId}`);
          } else {
            debugLog(`   ⚠️ Жанр не установлен`);
          }
        } else {
          debugLog(`   ℹ️ Жанр не указан в файле`);
          if (defaultGenreId) {
            bookData.genre_id = defaultGenreId;
            debugLog(`   ℹ️ Используем жанр по умолчанию: ID ${defaultGenreId}`);
          }
        }
        
        // Если есть ошибки, пропускаем
        if (rowErrors.length > 0) {
          debugLog(`   ❌ Ошибки:`, rowErrors);
          stats.errors++;
          stats.details.push({
            row: i + 1,
            success: false,
            errors: rowErrors,
            data: { ...row }
          });
          continue;
        }
        
        // Проверка дубликатов
        if (skipDuplicates) {
          const existing = await Book.findOne({
            where: {
              title: bookData.title,
              author: bookData.author
            }
          });
          
          if (existing) {
            debugLog(`   ⏭️ Найден дубликат, пропускаем`);
            stats.skipped++;
            stats.details.push({
              row: i + 1,
              success: false,
              error: 'Дубликат',
              data: { ...row }
            });
            continue;
          }
        }
        
        // Добавляем обязательные поля
        bookData.cover_image = 'default-book-cover.jpg';
        bookData.views_count = 0;
        
        debugLog(`   💾 Сохраняем книгу:`, {
          title: bookData.title,
          author: bookData.author,
          genre_id: bookData.genre_id || 'не указан'
        });
        
        // Создаём книгу
        await Book.create(bookData);
        
        debugLog(`   ✅ Книга успешно создана`);
        stats.success++;
        stats.details.push({
          row: i + 1,
          success: true,
          data: { 
            title: bookData.title,
            author: bookData.author,
            genre_id: bookData.genre_id
          }
        });
        
      } catch (error) {
        console.error(`   ❌ Ошибка:`, error.message);
        stats.errors++;
        stats.details.push({
          row: i + 1,
          success: false,
          error: error.message,
          data: { ...row }
        });
      }
    }
    
    // Удаляем временный файл
    fs.unlinkSync(filePath);
    
    debugLog('\n📊 ===== ИТОГИ ИМПОРТА =====');
    debugLog(`   Всего записей: ${stats.total}`);
    debugLog(`   ✅ Успешно: ${stats.success}`);
    debugLog(`   ❌ Ошибок: ${stats.errors}`);
    debugLog(`   ⏭️ Пропущено: ${stats.skipped}`);
    
    // Отправляем уведомление
    await notificationService.booksImported(req.session.user.id, stats);
    
    // Сохраняем результат в сессии
    req.session.importResult = stats;
    
    req.flash('success', `Импорт завершён. Добавлено: ${stats.success}, ошибок: ${stats.errors}, пропущено: ${stats.skipped}`);
    res.redirect('/admin/import/result');
    
  } catch (error) {
    console.error('❌ Критическая ошибка при импорте:', error);
    
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
      const headers = ['title', 'author', 'description', 'year', 'pages', 'publisher', 'isbn', 'genre'];
      const sample = ['Война и мир', 'Лев Толстой', 'Великий роман...', '1869', '1300', 'АСТ', '978-5-17-123456-7', 'Роман'];
      
      const csv = headers.join(',') + '\n' + sample.join(',');
      
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=books_template.csv');
      res.send(csv);
      
    } else if (type === 'json') {
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
      
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=books_template.json');
      res.send(JSON.stringify(template, null, 2));
    }
    
  } catch (error) {
    console.error('Ошибка при скачивании шаблона:', error);
    res.redirect('/admin/import');
  }
};

/**
 * Скачать пример с жанрами
 */
exports.downloadExampleWithGenres = async (req, res) => {
  try {
    // Получаем реальные жанры из БД
    const genres = await Genre.findAll({ limit: 10 });
    const genreNames = genres.map(g => g.name);
    
    const examples = [
      {
        title: 'Война и мир',
        author: 'Лев Толстой',
        description: 'Великий роман-эпопея',
        year: '1869',
        pages: '1300',
        publisher: 'АСТ',
        isbn: '978-5-17-123456-7',
        genre: genreNames[0] || 'Роман'
      },
      {
        title: 'Преступление и наказание',
        author: 'Фёдор Достоевский',
        description: 'Философский роман',
        year: '1866',
        pages: '672',
        publisher: 'Эксмо',
        isbn: '978-5-04-123456-8',
        genre: genreNames[0] || 'Роман'
      },
      {
        title: '1984',
        author: 'Джордж Оруэлл',
        description: 'Антиутопия',
        year: '1949',
        pages: '320',
        publisher: 'Азбука',
        isbn: '978-5-389-12345-6',
        genre: genreNames[1] || 'Фантастика'
      }
    ];
    
    const headers = ['title', 'author', 'description', 'year', 'pages', 'publisher', 'isbn', 'genre'];
    const csvRows = [];
    
    csvRows.push(headers.join(','));
    
    examples.forEach(book => {
      const values = headers.map(header => {
        const value = book[header] || '';
        return value.includes(',') ? `"${value}"` : value;
      });
      csvRows.push(values.join(','));
    });
    
    const csv = csvRows.join('\n');
    
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=books_example_with_genres.csv');
    res.send(csv);
    
  } catch (error) {
    console.error('Ошибка при скачивании примера:', error);
    res.redirect('/admin/import');
  }
};
