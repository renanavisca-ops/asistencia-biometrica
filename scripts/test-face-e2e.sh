#!/usr/bin/env bash
# E2E facial con backend local: Postgres (migraciones reales) + device-api (Deno) + app compilada con cámara simulada.
# Requiere: Postgres 16, Deno, ffmpeg, Playwright (Chromium), modelos (scripts/fetch-models.mjs).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}"; DENO="${DENO:-deno}"; PORT=55442
W="$(mktemp -d /tmp/fe2e.XXXX)"; chmod 777 "$W"
pg() { if [ "$(id -u)" = "0" ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
cleanup() { kill "${DPID:-0}" 2>/dev/null || true; pg "$PGBIN/pg_ctl -D $W/db -m immediate stop" >/dev/null 2>&1 || true; rm -rf "$W"; }
trap cleanup EXIT
reset_db() {
  pg "$PGBIN/pg_ctl -D $W/db -m immediate stop" >/dev/null 2>&1 || true; rm -rf "$W/db"
  pg "$PGBIN/initdb -D $W/db -A trust -U postgres" >/dev/null
  pg "$PGBIN/pg_ctl -D $W/db -o '-p $PORT -k $W/db -c listen_addresses=127.0.0.1' -l $W/db/log start" >/dev/null
  P=(psql -h 127.0.0.1 -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
  "${P[@]}" -f "$ROOT/supabase/tests/00_supabase_stub.sql"; for f in "$ROOT"/supabase/migrations/*.sql; do "${P[@]}" -f "$f" 2>&1 | grep -v NOTICE || true; done
}
node "$ROOT/scripts/fetch-models.mjs" >/dev/null; node "$ROOT/scripts/sync-shared.mjs" >/dev/null
cd "$ROOT/apps/kiosk"; export NODE_PATH="$(npm root -g)"
node test-biometric-engine.mjs > "$W/bio.json"; node -e "const t=require('fs').readFileSync('$W/bio.json','utf8');const j=JSON.parse(t.slice(0,t.lastIndexOf('\n}')+2));require('fs').writeFileSync('$W/tpl.json',JSON.stringify(j.templates))"
for who in a b; do
  python3 - "$W" "$who" <<'PY'
import sys, urllib.request, io
from PIL import Image
w, who = sys.argv[1], sys.argv[2]
url = {'a': 'https://storage.googleapis.com/mediapipe-assets/portrait.jpg', 'b': 'https://storage.googleapis.com/mediapipe-assets/business-person.png'}[who]
im = Image.open(io.BytesIO(urllib.request.urlopen(url).read())).convert('RGB'); W_, H_ = im.size
c = im.crop((int(W_*0.1), 0, int(W_*0.9), int(H_*0.5))) if who == 'a' else im.crop((int(W_*0.2), 0, int(W_*0.8), int(H_*0.4)))
can = Image.new('RGB', (640, 480), (90, 90, 90)); c.thumbnail((640, 480)); can.paste(c, ((640-c.width)//2, (480-c.height)//2)); can.save(f'{w}/cam_{who}.png')
PY
  ffmpeg -loglevel error -y -loop 1 -i "$W/cam_$who.png" -t 10 -r 15 -pix_fmt yuv420p "$W/cam_$who.y4m"
done
run() { # nombre, variables...
  local name="$1"; shift; reset_db
  ( cd "$ROOT/supabase/functions/device-api" && DATABASE_URL=postgres://postgres@127.0.0.1:$PORT/postgres exec "$DENO" run --allow-net --allow-env --allow-read serve_local.ts ) >"$W/deno.log" 2>&1 & DPID=$!
  for i in $(seq 1 30); do curl -s -o /dev/null http://127.0.0.1:8787/device-api/x && break; sleep 0.5; done
  echo "── $name"
  env DATABASE_URL=postgres://postgres@127.0.0.1:$PORT/postgres DEVICE_API=http://127.0.0.1:8787 "$@" node face-e2e.mjs "$W/cam_${CAM:-a}.y4m" "$W/tpl.json" | grep -E "^OK|FALLO|outcome|elapsed"
  kill $DPID 2>/dev/null || true; wait $DPID 2>/dev/null || true
}
CAM=a run "Foto estática con desafío activo → debe rechazarse" EXPECT_OUTCOME=PRUEBA_DE_VIDA_FALLIDA
CAM=a run "Solo prueba pasiva (activeChallenge=0) → reconoce A" EXPECT="Persona Alfa" POLICY='{"matchThreshold":0.4,"matchMargin":0.08,"padThreshold":0.8,"activeChallenge":0}'
CAM=b run "Solo pasiva → reconoce B" EXPECT="Persona Beta" POLICY='{"matchThreshold":0.4,"matchMargin":0.08,"padThreshold":0.8,"activeChallenge":0}'
CAM=a run "No enrolado → rechazo" NEGATIVE=1 POLICY='{"matchThreshold":0.4,"matchMargin":0.08,"padThreshold":0.8,"activeChallenge":0}'
CAM=a run "Umbral pasivo imposible (0.9999) → prueba de vida fallida" EXPECT_OUTCOME=PRUEBA_DE_VIDA_FALLIDA POLICY='{"matchThreshold":0.4,"matchMargin":0.08,"padThreshold":0.9999,"activeChallenge":0}'
CAM=a run "Sin umbrales publicados → sin calibrar" EXPECT_OUTCOME=SIN_CALIBRAR POLICY='{"minSessionMinutes":30}'
