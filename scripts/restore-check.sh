#!/usr/bin/env bash
# Восстановление бэкапа в отдельную базу — и проверка, что там правда данные.
#
#   TARGET_URL='postgres://.../knigomany_restore' ./scripts/restore-check.sh backups/knigomany-....sql.gz
#
# Зачем отдельная база: восстановление поверх рабочей — это как раз тот
# случай, когда «проверил бэкап» превращается в «удалил прод».
#
# Скрипт отвечает на три вопроса:
#   1. разворачивается ли архив без ошибок;
#   2. есть ли в нём таблицы и строки;
#   3. работает ли приложение с этой базой (миграции видят все шаги).

set -euo pipefail

FILE="${1:?укажи файл бэкапа: ./scripts/restore-check.sh backups/knigomany-....sql.gz}"
TARGET_URL="${TARGET_URL:?нужен TARGET_URL — пустая база для проверки}"

if [[ "$TARGET_URL" == *knigomany* && "$TARGET_URL" == *prod* ]]; then
  echo "[restore] ОТКАЗ: TARGET_URL похож на рабочую базу" >&2
  exit 1
fi

echo "[restore] разворачиваю $FILE"
if [[ "$FILE" == *.gz ]]; then
  gunzip -c "$FILE" | psql "$TARGET_URL" --quiet --no-psqlrc --set ON_ERROR_STOP=1 > /dev/null
else
  psql "$TARGET_URL" --quiet --no-psqlrc --set ON_ERROR_STOP=1 -f "$FILE" > /dev/null
fi

count() {
  psql "$TARGET_URL" --no-psqlrc -tAc "SELECT COUNT(*) FROM $1"
}

USERS=$(count users)
BOOKS=$(count books)
ENTRIES=$(count library_entries)
MIGRATIONS=$(count migrations)

echo "[restore] users=$USERS books=$BOOKS library_entries=$ENTRIES migrations=$MIGRATIONS"

if [[ "$USERS" -lt 1 ]]; then
  echo "[restore] ОШИБКА: в восстановленной базе нет пользователей" >&2
  exit 1
fi
if [[ "$MIGRATIONS" -lt 1 ]]; then
  echo "[restore] ОШИБКА: нет таблицы migrations — схема не восстановилась" >&2
  exit 1
fi

echo "[restore] ок: бэкап разворачивается и содержит данные"
echo "[restore] последний шаг — открыть приложение на этой базе:"
echo "  DATABASE_URL='$TARGET_URL' NODE_ENV=production PORT=4000 node src/server.js"
