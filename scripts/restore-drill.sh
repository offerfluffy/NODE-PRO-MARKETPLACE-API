#!/usr/bin/env bash

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

: "${DATABASE_URL:?DATABASE_URL: unbound variable}"

BACKUP_DIR="${BACKUP_DIR:-"$PWD/backups"}"
LATEST_BACKUP=""

for candidate in "$BACKUP_DIR"/*.dump; do
  [[ -f "$candidate" ]] || continue

  if [[ -z "$LATEST_BACKUP" || "$candidate" -nt "$LATEST_BACKUP" ]]; then
    LATEST_BACKUP="$candidate"
  fi
done

if [[ -z "$LATEST_BACKUP" ]]; then
  echo "No backup files found in $BACKUP_DIR" >&2
  exit 1
fi

echo "Latest backup: $LATEST_BACKUP"

RESTORE_SERVICE="restore"
RESTORE_VOLUME="marketplace-api-restore-drill-data"

cleanup() {
  docker compose --profile drill rm --stop --force \
    "$RESTORE_SERVICE" >/dev/null 2>&1 || true

  docker volume rm --force \
    "$RESTORE_VOLUME" >/dev/null 2>&1 || true
}

trap cleanup EXIT

# Remove leftovers from an interrupted previous drill.
cleanup

# Start a completely empty PostgreSQL restore target.
docker compose --profile drill up -d --wait "$RESTORE_SERVICE"

ORDERS_TABLE_COUNT="$(
  docker compose --profile drill exec -T "$RESTORE_SERVICE" \
    psql -U restore_admin -d shop_restore -Atc \
    "SELECT count(*) FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename = 'orders';"
)"

if [[ "$ORDERS_TABLE_COUNT" != "0" ]]; then
  echo "Restore database is not empty" >&2
  exit 1
fi

echo "Clean restore target ready"

CHECK_SQL="
  SELECT count(*) || '|' || COALESCE(sum(total_amount_cents), 0)
  FROM public.orders;
"

SOURCE_RESULT="$(psql "$DATABASE_URL" -Atc "$CHECK_SQL")"

echo "Source orders result: $SOURCE_RESULT"

RESTORE_STARTED_AT=$SECONDS

docker compose --profile drill exec -T "$RESTORE_SERVICE" \
  pg_restore \
    --username=restore_admin \
    --dbname=shop_restore \
    --no-owner \
    < "$LATEST_BACKUP"

RESTORE_SECONDS=$((SECONDS - RESTORE_STARTED_AT))

RESTORED_RESULT="$(
  docker compose --profile drill exec -T "$RESTORE_SERVICE" \
    psql -U restore_admin -d shop_restore -Atc "$CHECK_SQL"
)"

echo "Restored orders result: $RESTORED_RESULT"
echo "Restore time: ${RESTORE_SECONDS}s"

if [[ "$SOURCE_RESULT" != "$RESTORED_RESULT" ]]; then
  echo "MISMATCH: restored data differs from the source database" >&2
  exit 1
fi

echo "MATCH: orders count and total amount are identical"