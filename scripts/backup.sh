#!/usr/bin/env bash
# Бэкап базы: дамп, сжатие, проверка целостности, ротация.
#
#   DATABASE_URL='postgres://...' ./scripts/backup.sh
#
# Кладёт файлы в ./backups (в git не попадают) и удаляет всё старше 14 дней.
#
# Чего этот скрипт НЕ делает: не проверяет, что из бэкапа можно восстановиться.
# Это отдельный шаг — restore.sh, и его нужно запускать руками, а не «когда-нибудь».
# Бэкап, который ни разу не разворачивали, бэкапом не считается.

set -euo pipefail

DATABASE_URL="${DATABASE_URL:?нужен DATABASE_URL}"
DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
FILE="$DIR/knigomany-$STAMP.sql.gz"

mkdir -p "$DIR"

echo "[backup] дамп в $FILE"
pg_dump "$DATABASE_URL" --no-owner --no-privileges --clean --if-exists | gzip -9 > "$FILE"

# Пустой файл — это не бэкап, а авария: проверяем размер и содержимое
SIZE=$(wc -c < "$FILE" | tr -d ' ')
if [[ "$SIZE" -lt 1000 ]]; then
  echo "[backup] ОШИБКА: дамп подозрительно мал ($SIZE байт)" >&2
  rm -f "$FILE"
  exit 1
fi

if ! gzip -t "$FILE"; then
  echo "[backup] ОШИБКА: архив повреждён" >&2
  exit 1
fi

# В дампе должны быть наши таблицы, иначе dump снял пустую базу
if ! zcat "$FILE" | grep -q "CREATE TABLE.*users"; then
  echo "[backup] ОШИБКА: в дампе нет таблицы users — похоже, сняли не ту базу" >&2
  exit 1
fi

echo "[backup] ок: $(du -h "$FILE" | cut -f1)"

# Ротация: старые файлы удаляем, чтобы диск не закончился молча
find "$DIR" -name 'knigomany-*.sql.gz' -mtime "+$KEEP_DAYS" -print -delete | while read -r old; do
  echo "[backup] удалён старый $old"
done

echo "[backup] готово. Проверить восстановление: ./scripts/restore-check.sh"
