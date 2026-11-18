#!/usr/bin/env bash
# Запуск сайта «Книгоманы» локально — одной командой.
#
#   ./start.sh          обычный режим: база в файле .data/, данные сохраняются
#   ./start.sh --reset  начать с чистой базы (демо-данные зальются заново)
#
# Postgres устанавливать не нужно: используется PGlite — Postgres внутри Node.
# Остановить сервер: Ctrl+C.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js не найден. Установите Node 22 с https://nodejs.org (LTS) и повторите."
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Нужен Node 20 или новее, у вас $(node -v). Скачайте LTS: https://nodejs.org"
  exit 1
fi

if [ ! -d node_modules ] || [ ! -f node_modules/.package-lock.json ]; then
  echo "== Устанавливаю зависимости (один раз, это займёт пару минут) =="
  npm ci
fi

if [ "${1:-}" = "--reset" ]; then
  echo "== Чищу базу .data/ =="
  rm -rf .data
fi

echo "== Запускаю: http://localhost:3000 =="
echo "   Вход для проверки админки: anna@example.com / reader2026"
echo "   Остановить: Ctrl+C"
DB_DRIVER=pglite \
PGLITE_DATA_DIR="$PWD/.data" \
DB_SEED="${DB_SEED:-true}" \
PORT="${PORT:-3000}" \
exec node src/server.js
