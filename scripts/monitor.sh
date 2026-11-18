#!/usr/bin/env bash
# Проверка доступности: запускать из cron каждую минуту.
#
#   * * * * * /путь/scripts/monitor.sh >> /var/log/knigomany-monitor.log 2>&1
#
# Что проверяется:
#  1. healthz отвечает 200 (сервер жив и база отвечает)
#  2. главная отдаётся быстрее 3 секунд
#  3. сертификат не истёк (curl сам ругается, если истёк)
#
# Уведомление в Telegram — через TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID.
# Без них скрипт просто пишет в лог и возвращает код 1: это годится для
# systemd или любого монитора, который умеет «упал — сообщи».

set -uo pipefail

SITE="${SITE:-https://knigomany.ru}"
TIMEOUT="${TIMEOUT:-10}"
LOG_PREFIX="[$(date -u +%Y-%m-%dT%H:%M:%SZ)]"

notify() {
  local text="$1"
  echo "$LOG_PREFIX $text"

  if [[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_CHAT_ID:-}" ]]; then
    curl -s -m 10 -X POST \
      "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d "chat_id=${TELEGRAM_CHAT_ID}" \
      -d "text=$(printf '%s' "$SITE — $text" | sed 's/ /%20/g')" \
      > /dev/null || echo "$LOG_PREFIX не удалось отправить уведомление в Telegram"
  fi
}

fail() {
  notify "ПРОБЛЕМА: $1"
  exit 1
}

health_code=$(curl -s -o /dev/null -w '%{http_code}' -m "$TIMEOUT" "$SITE/healthz") || fail "healthz не отвечает"
[[ "$health_code" == "200" ]] || fail "healthz вернул $health_code"

health_body=$(curl -s -m "$TIMEOUT" "$SITE/healthz")
if [[ "$health_body" != *'"ok":true'* ]]; then
  fail "healthz вернул не ok: $health_body"
fi

# Главная: заодно проверяет, что шаблоны и база работают вместе
home_time=$(curl -s -o /dev/null -w '%{time_total}' -m "$TIMEOUT" "$SITE/") || fail "главная не отвечает"
home_code=$(curl -s -o /dev/null -w '%{http_code}' -m "$TIMEOUT" "$SITE/") || fail "главная не отвечает"
[[ "$home_code" == "200" ]] || fail "главная вернула $home_code"

if awk "BEGIN { exit !($home_time > 3) }"; then
  notify "медленно: главная отвечает ${home_time}s (порог 3s)"
fi

echo "$LOG_PREFIX ok: healthz 200, главная 200 за ${home_time}s"
exit 0
