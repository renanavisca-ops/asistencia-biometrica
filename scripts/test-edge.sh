#!/usr/bin/env bash
# Prueba de integración de la Edge Function device-api contra un Postgres local con las migraciones reales.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PORT="${PGPORT_TEST:-55433}"
DENO="${DENO:-deno}"
RUN_AS=(); [ "$(id -u)" = "0" ] && RUN_AS=(su postgres -c)
DATA="$(mktemp -d)"; chmod 777 "$DATA"
pg() { if [ ${#RUN_AS[@]} -gt 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
cleanup() { pg "$PGBIN/pg_ctl -D $DATA/db -m immediate stop" >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap cleanup EXIT
pg "$PGBIN/initdb -D $DATA/db -A trust -U postgres" >/dev/null
pg "$PGBIN/pg_ctl -D $DATA/db -o '-p $PORT -k $DATA/db -c listen_addresses=127.0.0.1' -l $DATA/db/log start" >/dev/null
PSQL=(psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -f "$ROOT/supabase/tests/00_supabase_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f"; done
node "$ROOT/scripts/sync-shared.mjs" >/dev/null
cd "$ROOT/supabase/functions/device-api"
DATABASE_URL="postgres://postgres@127.0.0.1:$PORT/postgres" "$DENO" test --allow-net --allow-env --allow-read handler_test.ts
