#!/usr/bin/env bash
# Reportes del panel: datos generados por las migraciones reales (ingesta, tardanzas, ciclo laboral) en Postgres local.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PORT="${PGPORT_TEST:-55435}"
DATA="$(mktemp -d)"; chmod 777 "$DATA"
pg() { if [ "$(id -u)" = "0" ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
cleanup() { pg "$PGBIN/pg_ctl -D $DATA/db -m immediate stop" >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap cleanup EXIT
pg "$PGBIN/initdb -D $DATA/db -A trust -U postgres" >/dev/null
pg "$PGBIN/pg_ctl -D $DATA/db -o '-p $PORT -k $DATA/db -c listen_addresses=127.0.0.1' -l $DATA/db/log start" >/dev/null
PSQL=(psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -f "$ROOT/supabase/tests/00_supabase_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f"; done

cd "$ROOT/apps/admin"
DATABASE_URL="postgres://postgres@127.0.0.1:$PORT/postgres" npx vitest run test/
