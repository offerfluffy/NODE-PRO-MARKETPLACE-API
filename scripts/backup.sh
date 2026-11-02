#!/usr/bin/env bash

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

: "${DATABASE_URL:?DATABASE_URL: unbound variable}"

BACKUP_DIR="${BACKUP_DIR:-"$PWD/backups"}"
TIMESTAMP="$(date '+%Y-%m-%d_%H-%M-%S')"
BACKUP_PATH="$BACKUP_DIR/shop_$TIMESTAMP.dump"
PG_DUMP_BIN="${PG_DUMP_BIN:-pg_dump}"
EXPECTED_PG_DUMP_MAJOR="16"

if ! PG_DUMP_VERSION="$("$PG_DUMP_BIN" --version 2>/dev/null)"; then
  echo "PostgreSQL ${EXPECTED_PG_DUMP_MAJOR} pg_dump is required: $PG_DUMP_BIN is not executable" >&2
  exit 1
fi

PG_DUMP_MAJOR="$(printf '%s\n' "$PG_DUMP_VERSION" | awk '{ print $3 }' | cut -d. -f1)"

if [[ "$PG_DUMP_MAJOR" != "$EXPECTED_PG_DUMP_MAJOR" ]]; then
  echo "PostgreSQL ${EXPECTED_PG_DUMP_MAJOR} pg_dump is required, found: $PG_DUMP_VERSION" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

BACKUP_TEMP="$(mktemp "$BACKUP_DIR/.shop_${TIMESTAMP}.XXXXXX.dump")"

cleanup() {
  rm -f "$BACKUP_TEMP"
}

trap cleanup EXIT

"$PG_DUMP_BIN" \
  --dbname="$DATABASE_URL" \
  --format=custom \
  --file="$BACKUP_TEMP"

if [[ ! -s "$BACKUP_TEMP" ]]; then
  echo "Backup file is missing or empty: $BACKUP_TEMP" >&2
  exit 1
fi

mv "$BACKUP_TEMP" "$BACKUP_PATH"
trap - EXIT

echo "Backup created: $BACKUP_PATH"
