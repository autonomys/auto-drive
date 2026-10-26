#!/usr/bin/env bash
# Migrates and seeds the database, then hands over to supervisord.
set -euo pipefail

: "${AUTO_DRIVE_TEST_ACCESS_KEY_ID:?must not be empty}"

LOGS=/var/log/auto-drive-test
mkdir -p "$LOGS" /run/auto-drive-test /var/lib/auto-drive-test
install -d -o autodrive -g autodrive "$CACHE_DIR"
rm -f /run/auto-drive-test/ready

# Shared by auth and the backend for their internal calls; nothing outside the
# container can reach auth.
internal_secret=$(openssl rand -hex 16)
export API_SECRET=$internal_secret AUTH_SERVICE_API_KEY=$internal_secret JWT_SECRET=$internal_secret

if [[ ! -s $PGDATA/PG_VERSION ]]; then
  install -d -o postgres -g postgres -m 700 "$PGDATA"
  gosu postgres initdb --auth=trust --username=postgres -D "$PGDATA" >"$LOGS/initdb.log"
  # Throwaway data: durability settings only cost time here.
  cat >>"$PGDATA/postgresql.conf" <<'EOF'
listen_addresses = '127.0.0.1'
fsync = off
synchronous_commit = off
full_page_writes = off
EOF
fi

install -o postgres -g postgres -m 644 /dev/null "$LOGS/postgres-setup.log"
gosu postgres pg_ctl -D "$PGDATA" -w -l "$LOGS/postgres-setup.log" start >/dev/null
if ! gosu postgres psql -h 127.0.0.1 -tAc "SELECT 1 FROM pg_database WHERE datname = 'autodrive'" | grep -q 1; then
  gosu postgres createdb -h 127.0.0.1 autodrive
fi

migrate() {
  local app=$1
  shift
  if ! (cd "/usr/src/app/apps/$app" && node /usr/src/app/node_modules/db-migrate/bin/db-migrate "$@" up) \
    >"$LOGS/migrate-$app.log" 2>&1; then
    echo "auto-drive-test: $app migrations failed:" >&2
    tail -n 30 "$LOGS/migrate-$app.log" >&2
    exit 1
  fi
}
migrate backend
migrate auth -t auth_migrations

psql -h 127.0.0.1 -U postgres -d autodrive -q -v key="$AUTO_DRIVE_TEST_ACCESS_KEY_ID" \
  -f /etc/auto-drive-test/seed.sql
gosu postgres pg_ctl -D "$PGDATA" -m fast -w stop >/dev/null

exec supervisord -c /etc/auto-drive-test/supervisord.conf
