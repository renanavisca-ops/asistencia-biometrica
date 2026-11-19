#!/usr/bin/env bash
# Prueba de navegador del panel: Postgres local (migraciones reales + datos de prueba) → PostgREST real (Docker) →
# pasarela local (sesiones y Storage simulados con las políticas RLS reales) → panel Next.js compilado → Chromium.
# No usa producción. Requiere: Postgres local, Docker con la imagen postgrest/postgrest:v12.2.3, Playwright.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PORT="${PGPORT_TEST:-55440}"
export JWT_SECRET="${JWT_SECRET:-solo-pruebas-locales-panel-e2e-0001}"  # secreto local de prueba (no es de producción)
DATA="$(mktemp -d)"; chmod 777 "$DATA"
pg() { if [ "$(id -u)" = "0" ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
PIDS=()
cleanup() {
  for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done
  pkill -f "next start -p 3100" 2>/dev/null || true; pkill -f "^next-server" 2>/dev/null || true; pkill -f "^node e2e/gateway.mjs" 2>/dev/null || true
  docker rm -f panel-e2e-postgrest >/dev/null 2>&1 || true
  pg "$PGBIN/pg_ctl -D $DATA/db -m immediate stop" >/dev/null 2>&1 || true; rm -rf "$DATA"
}
trap cleanup EXIT
pg "$PGBIN/initdb -D $DATA/db -A trust -U postgres" >/dev/null
pg "$PGBIN/pg_ctl -D $DATA/db -o '-p $PORT -k $DATA/db -c listen_addresses=127.0.0.1' -l $DATA/db/log start" >/dev/null
PSQL=(psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -f "$ROOT/supabase/tests/00_supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f" >/dev/null 2>&1 || { echo "migración falló: $f"; "${PSQL[@]}" -f "$f"; exit 1; }; done
"${PSQL[@]}" -f "$ROOT/apps/admin/e2e/seed.sql" >/dev/null
export DATABASE_URL="postgres://postgres@127.0.0.1:$PORT/postgres"

docker rm -f panel-e2e-postgrest >/dev/null 2>&1 || true
pkill -f "^next-server" 2>/dev/null || true; pkill -f "^node e2e/gateway.mjs" 2>/dev/null || true
docker run -d --name panel-e2e-postgrest --network host \
  -e PGRST_DB_URI="$DATABASE_URL" -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$JWT_SECRET" \
  -e PGRST_SERVER_PORT=3001 -e PGRST_SERVER_HOST=127.0.0.1 postgrest/postgrest:v12.2.3 >/dev/null
for i in $(seq 1 30); do curl -s -o /dev/null http://127.0.0.1:3001/ && break; sleep 1; done

cd "$ROOT/apps/admin"
ANON=$(node -e "const c=require('crypto');const b=o=>Buffer.from(JSON.stringify(o)).toString('base64url');const h=b({alg:'HS256',typ:'JWT'}),p=b({role:'anon',iss:'e2e',exp:2000000000});console.log(h+'.'+p+'.'+c.createHmac('sha256',process.env.JWT_SECRET).update(h+'.'+p).digest('base64url'))")
REST_URL=http://127.0.0.1:3001 FILES_DIR="$DATA/files" node e2e/gateway.mjs > "$DATA/gateway.log" 2>&1 & PIDS+=($!)
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON"
if [ "${SKIP_BUILD:-0}" != "1" ]; then npx next build > "$DATA/build.log" 2>&1 || { tail -30 "$DATA/build.log"; exit 1; }; fi
npx next start -p 3100 > "$DATA/next.log" 2>&1 & PIDS+=($!)
for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3100/login && break; sleep 1; done
PANEL_URL=http://localhost:3100 SHOTS="${SHOTS:-$ROOT/apps/admin/e2e/screenshots}" node e2e/panel.e2e.mjs || { echo '--- next.log'; tail -40 "$DATA/next.log"; echo '--- gateway.log'; tail -20 "$DATA/gateway.log"; exit 1; }
