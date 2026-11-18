'use strict';

/**
 * Приём CSV-файла без multer.
 *
 * Импорт приходит обычной multipart-формой (input type=file). multer нам не нужен:
 * файл — это одно текстовое поле. Разбираем тело сами, читаем только поле `file`,
 * и жёстко ограничиваем размер, чтобы пятимегабайтная выгрузка не съела память
 * целиком и не превратилась в 500.
 */

const LIMIT_BYTES = 6 * 1024 * 1024;

function readField(buffer, name) {
  const text = buffer.toString('binary');
  const pattern = new RegExp(`name="${name}"[^]*?\\r\\n\\r\\n([^]*?)\\r\\n--`);
  const match = text.match(pattern);
  if (!match) return '';
  // Тело пришло в binary: возвращаем исходные байты и декодируем как UTF-8
  return Buffer.from(match[1], 'binary').toString('utf8');
}

/**
 * Возвращает middleware: если форма multipart — кладёт поля в req.body,
 * при превышении размера отвечает 413 с понятным текстом.
 */
function csvUpload(field = 'csv') {
  return function middleware(req, res, next) {
    const type = String(req.headers['content-type'] || '');
    if (!type.includes('multipart/form-data')) return next();

    const chunks = [];
    let size = 0;
    let stopped = false;

    req.on('data', (chunk) => {
      if (stopped) return;
      size += chunk.length;
      if (size > LIMIT_BYTES) {
        stopped = true;
        res.status(413).send('Файл больше 5 МБ. Разделите выгрузку на части.');
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (stopped) return;
      const buffer = Buffer.concat(chunks);
      if (!req.body) req.body = {};
      // Текстовые поля формы + сам файл
      req.body.file = readField(buffer, 'file');
      req.body[field] = req.body[field] || readField(buffer, field);
      for (const key of ['dryRun']) {
        const value = readField(buffer, key);
        if (value && !req.body[key]) req.body[key] = value;
      }
      // Значение из скрытого поля CSRF тоже нужно проверить
      const token = readField(buffer, '_csrf');
      if (token) req.body._csrf = token;
      next();
    });

    req.on('error', () => next());
  };
}

module.exports = { csvUpload, readField, LIMIT_BYTES };
