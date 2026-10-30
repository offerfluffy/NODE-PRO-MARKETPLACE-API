#!/usr/bin/env bash

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

: "${DATABASE_URL:?DATABASE_URL: unbound variable}"

BACKUP_DIR="${BACKUP_DIR:-"$PWD/backups"}"
TIMESTAMP="$(date '+%Y-%m-%d_%H-%M-%S')"
BACKUP_PATH="$BACKUP_DIR/shop_$TIMESTAMP.dump"

mkdir -p "$BACKUP_DIR"

pg_dump \
  --dbname="$DATABASE_URL" \
  --format=custom \
  --file="$BACKUP_PATH"

if [[ ! -s "$BACKUP_PATH" ]]; then
  echo "Backup file is missing or empty: $BACKUP_PATH" >&2
  exit 1
fi

echo "Backup created: $BACKUP_PATH"