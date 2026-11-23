'use strict';

/**
 * Проверка окружения одной командой: `npm run doctor`.
 *
 * Отвечает на вопрос «почему не запускается» до того, как человек начнёт
 * читать стектрейсы: версия Node, установлены ли зависимости, работает ли
 * bcrypt (на Windows он собирается нативно), какая база будет использована.
 */

require('dotenv').config({ quiet: true });

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const ok = (text) => console.log(`  ✓ ${text}`);
const warn = (text) => console.log(`  ! ${text}`);
const bad = (text) => console.log(`  ✗ ${text}`);

async function main() {
  let problems = 0;

  console.log('\nПроверка окружения «Книгоманы»\n');

  // 1. Node
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 20) ok(`Node.js ${process.versions.node}`);
  else {
    bad(`Node.js ${process.versions.node} — нужен 20 или новее (скачайте LTS с nodejs.org)`);
    problems += 1;
  }

  // 2. Зависимости
  if (fs.existsSync(path.join(root, 'node_modules', 'sequelize'))) {
    ok('зависимости установлены');
  } else {
    bad('нет node_modules — выполните npm ci');
    problems += 1;
  }

  // 3. bcrypt: на Windows собирается нативно, и это частая причина падений
  try {
    const bcrypt = require('bcrypt');
    const hash = bcrypt.hashSync('проверка', 4);
    if (bcrypt.compareSync('проверка', hash)) ok('bcrypt работает (пароли хешируются)');
    else { bad('bcrypt вернул неверный хеш'); problems += 1; }
  } catch (error) {
    bad(`bcrypt не загрузился: ${error.message}`);
    warn('на Windows помогает: npm rebuild bcrypt');
    problems += 1;
  }

  // 4. Статика и контент на месте (ZIP иногда распаковывают частично)
  for (const [label, file] of [
    ['стили', 'public/css/base.css'],
    ['контент книг', 'content/books.json']
  ]) {
    if (fs.existsSync(path.join(root, file))) ok(`${label}: ${file}`);
    else { bad(`нет файла ${file}`); problems += 1; }
  }

  // 5. База
  const dbDriver = require('../src/config/db-driver');
  try {
    const choice = await dbDriver.resolveDriver();
    if (choice.driver === 'pglite') {
      warn(`будет встроенная база (PGlite): ${choice.reason}`);
      ok(`данные: ${dbDriver.dataDir()}`);
      if (fs.existsSync(path.join(dbDriver.dataDir(), 'PG_VERSION'))) {
        ok('база уже создана — данные сохранятся');
      } else {
        warn('база создастся при первом запуске, демо-данные зальются автоматически');
      }
    } else {
      ok(`будет PostgreSQL: ${choice.reason}`);
    }
  } catch (error) {
    bad(`не удалось определить базу: ${error.message}`);
    problems += 1;
  }

  // 6. Что дальше
  console.log('');
  if (problems) {
    console.log(`Найдено проблем: ${problems}. Исправьте их — и запускайте: npm run dev\n`);
    process.exitCode = 1;
  } else {
    console.log('Всё готово. Запуск: npm run dev → http://localhost:3000');
    console.log('Вход: anna@example.com / reader2026\n');
  }
}

main().catch((error) => {
  console.error('Проверка упала:', error.message);
  process.exitCode = 1;
});
