#!/usr/bin/env bash
# Securely add external serverless PostgreSQL/Redis URLs to Secret Manager.
# Run as a child process; values are read without terminal echo and never logged.
set -Eeuo pipefail

PROJECT_ID="${PROJECT_ID:-travelcanvas-development}"
LOG_FILE="${HOME}/travelcanvas_data_services_$(date +%Y%m%d_%H%M%S).log"
trap 'rc=$?; echo "[ERROR] line ${LINENO}, exit ${rc}. Parent console remains open." | tee -a "$LOG_FILE"; exit "$rc"' ERR

log() { printf '%s\n' "$*" | tee -a "$LOG_FILE"; }
add_value() {
  local secret="$1" value="$2"
  printf '%s' "$value" | gcloud secrets versions add "$secret" --project="$PROJECT_ID" --data-file=- >/dev/null
  log "[OK] added a new secret version: $secret"
}

log "===== TravelCanvas dev data-service secret setup ====="
gcloud config set project "$PROJECT_ID" >/dev/null

read -rsp "PostgreSQL owner/migration URL (postgresql://...?...sslmode=require): " DB_OWNER_URL
printf '\n'
read -rsp "PostgreSQL application URL (different least-privilege role): " DB_APP_URL
printf '\n'
read -rsp "Redis TLS URL (rediss://...): " REDIS_URL_VALUE
printf '\n'

for pair in "owner:$DB_OWNER_URL" "app:$DB_APP_URL"; do
  value="${pair#*:}"
  if [[ "$value" != postgresql://* && "$value" != postgres://* ]]; then
    log "[REFUSED] PostgreSQL URL has an invalid scheme."
    exit 2
  fi
  if [[ "$value" != *"sslmode=require"* ]]; then
    log "[REFUSED] PostgreSQL URL must contain sslmode=require."
    exit 2
  fi
done
if [[ "$REDIS_URL_VALUE" != rediss://* ]]; then
  log "[REFUSED] Redis URL must use rediss:// (TLS)."
  exit 2
fi
if [[ "$DB_OWNER_URL" == "$DB_APP_URL" ]]; then
  log "[REFUSED] owner and application DB credentials must differ."
  exit 2
fi

add_value tc-dev-db-owner-url "$DB_OWNER_URL"
add_value tc-dev-db-app-url "$DB_APP_URL"
add_value tc-dev-redis-url "$REDIS_URL_VALUE"
unset DB_OWNER_URL DB_APP_URL REDIS_URL_VALUE value pair

log "PASS: secret versions added without printing their values."
log "Log: $LOG_FILE"
