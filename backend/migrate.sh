#!/usr/bin/env bash
set -Eeuo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set}"

echo "Waiting for database..."
for attempt in $(seq 1 60); do
  if pg_isready --dbname="${DATABASE_URL}" --quiet; then
    echo "Database is ready."
    echo "Running database migrations..."
    alembic upgrade head
    echo "Migration completed."
    exit 0
  fi
  sleep 2
done

echo "Database did not become ready within 120 seconds." >&2
exit 1
