#!/usr/bin/env bash

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

SECRET_FILE="secrets/db_password"
USERLIST_FILE="pgbouncer/userlist.txt"

if [[ ! -s "$SECRET_FILE" ]]; then
  echo "Missing or empty password file: $SECRET_FILE" >&2
  exit 1
fi

CURRENT_PASSWORD="$(<"$SECRET_FILE")"
PGBOUNCER_PASSWORD="$(
  awk '$1 == "\"app_user\"" { gsub(/^"|"$/, "", $2); print $2 }' \
    "$USERLIST_FILE"
)"

if [[ -z "$PGBOUNCER_PASSWORD" || "$CURRENT_PASSWORD" != "$PGBOUNCER_PASSWORD" ]]; then
  echo "Refusing rotation: $SECRET_FILE and $USERLIST_FILE are already out of sync" >&2
  exit 1
fi

NEW_PASSWORD="app-$(openssl rand -hex 8)"
USERLIST_BACKUP="$(mktemp)"
SECRET_BACKUP="$(mktemp)"
USERLIST_NEXT="$(mktemp)"
SECRET_NEXT="$(mktemp)"
ROLLBACK_REQUIRED=0

cp "$USERLIST_FILE" "$USERLIST_BACKUP"
cp "$SECRET_FILE" "$SECRET_BACKUP"

awk -v password="$NEW_PASSWORD" '
  $1 == "\"app_user\"" {
    print "\"app_user\" \"" password "\""
    found = 1
    next
  }
  { print }
  END { if (!found) exit 1 }
' "$USERLIST_FILE" > "$USERLIST_NEXT"

printf '%s' "$NEW_PASSWORD" > "$SECRET_NEXT"

set_db_password() {
  local password="$1"

  docker compose exec -T db psql -U admin -d shop \
    -v ON_ERROR_STOP=1 \
    -v "role_password=$password" >/dev/null <<'SQL'
SELECT format('ALTER ROLE app_user WITH PASSWORD %L', :'role_password')
\gexec
SQL
}

reload_pgbouncer() {
  docker compose exec -T -e PGPASSWORD=admin_bootstrap pgbouncer \
    psql -h 127.0.0.1 -p 5432 -U admin -d pgbouncer \
      -v ON_ERROR_STOP=1 -c "RELOAD;" >/dev/null
}

finish() {
  local status=$?
  trap - EXIT

  if [[ "$status" -ne 0 && "$ROLLBACK_REQUIRED" -eq 1 ]]; then
    echo "Rotation failed; restoring the previous password configuration" >&2
    set_db_password "$CURRENT_PASSWORD" || true
    cat "$USERLIST_BACKUP" > "$USERLIST_FILE"
    cat "$SECRET_BACKUP" > "$SECRET_FILE"
    reload_pgbouncer || true
  fi

  rm -f "$USERLIST_BACKUP" "$SECRET_BACKUP" "$USERLIST_NEXT" "$SECRET_NEXT"
  exit "$status"
}

trap finish EXIT

echo "1. ALTER ROLE in Postgres…"
set_db_password "$NEW_PASSWORD"
ROLLBACK_REQUIRED=1

echo "2. Update the application secret and PgBouncer auth file…"
# Keep the bind-mounted userlist inode so the running container sees the update.
cat "$USERLIST_NEXT" > "$USERLIST_FILE"
mv "$SECRET_NEXT" "$SECRET_FILE"

echo "3. Reload PgBouncer and verify the new credentials…"
reload_pgbouncer
docker compose exec -T -e PGPASSWORD="$NEW_PASSWORD" pgbouncer \
  psql -h 127.0.0.1 -p 5432 -U app_user -d shop \
    -v ON_ERROR_STOP=1 -c "SELECT 1;" >/dev/null

echo "4. Close old connections of app_user…"
docker compose exec -T db psql -U admin -d shop -tA \
  -c "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE usename = 'app_user';"

ROLLBACK_REQUIRED=0
echo "Done: the database, application secret, and PgBouncer credentials are in sync"
