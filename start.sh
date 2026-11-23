#!/usr/bin/env bash
# Запуск сайта «Книгоманы» — одной командой.
#
#   ./start.sh           обычный запуск (данные сохраняются в .data)
#   ./start.sh --reset   начать с чистой базы: пересоздать и залить демо-данные
#   ./start.sh --doctor  только проверить окружение, сайт не запускать
#
# Postgres и Docker не нужны: если Postgres не найден, сайт поднимется на
# встроенной базе (PGlite) в папке .data. Остановить: Ctrl+C.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js не найден. Установите Node 22 LTS с https://nodejs.org,"
  echo "затем откройте терминал заново и повторите."
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Нужен Node.js 20 или новее, у вас $(node -v). Скачайте LTS: https://nodejs.org"
  exit 1
fi

if [ ! -d node_modules ] || [ ! -f node_modules/.package-lock.json ]; then
  echo "== Устанавливаю зависимости (один раз, пара минут) =="
  npm ci
fi

case "${1:-}" in
  --doctor)
    npm run doctor
    exit 0
    ;;
  --reset)
    echo "== Чищу базу и заливаю демо-данные =="
    npm run db:reset
    ;;
esac

echo
echo "== Запускаю сайт: http://localhost:3000 =="
echo "   Вход: anna@example.com / reader2026"
echo "   Остановить: Ctrl+C"
echo
PORT="${PORT:-3000}" exec npm start
