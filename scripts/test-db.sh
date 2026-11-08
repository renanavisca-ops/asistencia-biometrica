#!/usr/bin/env bash
# Aplica las migraciones sobre un Postgres local efímero con un stub de Supabase y ejecuta las pruebas SQL.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
DATA="$(mktemp -d)"; PORT="${PGPORT_TEST:-55432}"
cleanup() { "$PGBIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap cleanup EXIT
if [ "$(id -u)" = "0" ]; then echo "Ejecutar como usuario no root (p. ej. su postgres)"; exit 1; fi
"$PGBIN/initdb" -D "$DATA" -A trust -U postgres >/dev/null
"$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k $DATA -c listen_addresses=''" -l "$DATA/log" start >/dev/null
PSQL=(psql -h "$DATA" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -f "$ROOT/supabase/tests/00_supabase_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do echo "→ migración $(basename "$f")"; "${PSQL[@]}" -f "$f"; done
for f in "$ROOT"/supabase/tests/[1-9]*.sql; do echo "→ prueba $(basename "$f")"; "${PSQL[@]}" -f "$f"; done
echo "OK: migraciones y pruebas SQL superadas"
