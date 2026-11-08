// E2E con rostro real: app compilada (Chromium, cámara simulada con un retrato) → device-api local (Deno) → Postgres local.
// Uso: DATABASE_URL=... DEVICE_API=http://127.0.0.1:8787 node face-e2e.mjs <video.y4m> <templates.json>
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { build, preview } from 'vite';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const postgres = (await import('postgres')).default;

const [videoFile, tplFile] = process.argv.slice(2);
const tpl = JSON.parse(readFileSync(tplFile, 'utf8'));
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const ORG = '61111111-0000-4000-8000-000000000000', REG = '61111111-0000-4000-8000-000000000001', HQ = '61111111-0000-4000-8000-000000000002';
const S1 = '61111111-0000-4000-8000-000000000003', A = '61111111-0000-4000-8000-000000000004', B = '61111111-0000-4000-8000-000000000005';
const ADMIN = '61111111-0000-4000-8000-000000000006', DEV = '61111111-0000-4000-8000-000000000008';

await sql.unsafe(`
  insert into public.organizations (id, name) values ('${ORG}', 'Prueba facial');
  insert into public.regions (id, organization_id, country_code, name, timezone) values ('${REG}', '${ORG}', 'GT', 'GT', 'America/Guatemala');
  insert into public.stores (id, organization_id, region_id, code, name, timezone, is_central) values
    ('${HQ}', '${ORG}', '${REG}', 'HQ', 'Central', 'America/Guatemala', true), ('${S1}', '${ORG}', '${REG}', 'S1', 'Sucursal 1', 'America/Guatemala', false);
  insert into public.employees (id, organization_id, first_name, last_name) values ('${A}', '${ORG}', 'Persona', 'Alfa'), ('${B}', '${ORG}', 'Persona', 'Beta');
  insert into public.employee_store_assignments (organization_id, employee_id, store_id, valid_from) values ('${ORG}', '${A}', '${S1}', now() - interval '1 day'), ('${ORG}', '${B}', '${S1}', now() - interval '1 day');
  insert into auth.users (id, email) values ('${ADMIN}', 'adm@x');
  insert into public.admins (user_id, display_name, email) values ('${ADMIN}', 'Adm', 'adm@x');
  insert into public.admin_role_grants (user_id, role, organization_id) values ('${ADMIN}', 'central_admin', '${ORG}');
  insert into public.model_versions (kind, name, version, license, embedding_dim, status) values ('recognition', 'sface', '2021dec', 'Apache-2.0 pesos; datos no verificados (EXPERIMENTAL)', 128, 'evaluation') on conflict do nothing;
  -- Umbral PROVISIONAL solo para esta prueba (la calibración real es la Etapa 4).
  insert into public.device_policy_versions (organization_id, version, policy) values ('${ORG}', 1, '${process.env.POLICY ?? '{"matchThreshold": 0.4, "matchMargin": 0.08, "padThreshold": 0.8, "activeChallenge": 1, "challengeTimeoutSec": 6}'}');
  insert into public.devices (id, organization_id, store_id, label) values ('${DEV}', '${ORG}', '${S1}', 'Tel S1');
  insert into public.device_enrollments (organization_id, device_id, code_hash, expires_at) values ('${ORG}', '${DEV}', encode(extensions.digest('FACE2345FACE', 'sha256'), 'hex'), now() + interval '1 hour');
`);
// NEGATIVE=1: solo se enrola a Beta; la cámara muestra a Alfa (no enrolada) → debe rechazarse.
for (const [emp, key] of process.env.NEGATIVE ? [[B, 'b']] : [[A, 'a'], [B, 'b']]) {
  await sql.begin(async (tx) => {
    await tx.unsafe('set local role authenticated');
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ADMIN, aal: 'aal2' })}, true)`;
    const [c] = await tx`insert into public.biometric_consents (organization_id, employee_id, legal_basis, notice_version, accepted_at, recorded_by) values (${ORG}, ${emp}, 'consentimiento_expreso', 'PRUEBA', now(), ${ADMIN}) returning id`;
    const [m] = await tx`select id from public.model_versions where name = 'sface' and version = '2021dec'`;
    const doc = emp === A ? '1111111111111' : '2222222222222';
    await tx`select public.set_employee_document(${emp}::uuid, 'DPI', 'GT', ${doc}, 'prueba automatizada')`;
    await tx`select public.verify_employee_document(${emp}::uuid, ${doc})`;
    await tx`select public.enroll_biometric(${emp}::uuid, ${c.id}::uuid, ${HQ}::uuid, 'prueba automatizada', ${tx.array(tpl[key])}::text[], '{}'::jsonb, true, null, ${m.id}::uuid, null)`;
  });
}

process.env.DEV_API_PROXY = process.env.DEVICE_API; process.env.VITE_DEVICE_API_URL = '/device-api';
const kroot = dirname(fileURLToPath(import.meta.url));
await build({ root: kroot, logLevel: 'error', build: { outDir: 'dist-e2e' } });
const server = await preview({ root: kroot, preview: { port: 5198, strictPort: true, proxy: { '/device-api': process.env.DEVICE_API } }, build: { outDir: 'dist-e2e' }, logLevel: 'error' });
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${videoFile}`] });
const page = await browser.newPage({ viewport: { width: 400, height: 820 } });
page.on('pageerror', (e) => console.error('pageerror', e.message)); page.on('console', (m) => { if (!m.text().includes('onnxruntime')) console.error('console', m.type(), m.text().slice(0, 300)); }); page.on('response', (r) => { if (r.status() >= 400) console.error('http', r.status(), r.url()); }); page.on('requestfailed', (r) => console.error('reqfail', r.url()));
await page.goto('http://127.0.0.1:5198/');
await page.fill('input', 'face-2345-face'); await page.click('button:has-text("Activar")');
await page.waitForSelector('text=Toque la pantalla', { timeout: 30000 }).catch(async (e) => { console.error('PANTALLA:', (await page.textContent('body'))?.slice(0, 600)); throw e; });
await page.waitForTimeout(3000); // sincronización inicial (roster con plantillas)
const t0 = Date.now();
await page.click('text=Toque la pantalla');
// La instrucción del desafío debe llegar a pintarse en pantalla (antes el bucle bloqueaba el repintado).
const challengeShown = page.waitForSelector('text=/Parpadee|Gire un poco/', { timeout: 30000 }).then(() => true, () => false);
const outcome = await Promise.race([
  page.waitForSelector('text=ENTRADA REGISTRADA', { timeout: 60000 }).then(() => 'ENTRADA'),
  page.waitForSelector('text=No reconocido', { timeout: 60000 }).then(() => 'NO_RECONOCIDO'),
  page.waitForSelector('text=Enrolamiento facial pendiente', { timeout: 60000 }).then(() => 'SIN_PLANTILLAS'),
  page.waitForSelector('text=sin calibrar', { timeout: 60000 }).then(() => 'SIN_CALIBRAR'),
  page.waitForSelector('text=Verificación no superada', { timeout: 60000 }).then(() => 'PRUEBA_DE_VIDA_FALLIDA'),
]);
const elapsed = Date.now() - t0;
const name = outcome === 'ENTRADA' ? await page.textContent('[role=status]') : null;
await page.screenshot({ path: process.env.SHOT ?? 'face-e2e.png' });
await page.waitForTimeout(6000); // sincronización tras la marcación
const ev = await sql`select e.first_name || ' ' || e.last_name n, a.event_type, a.status, a.recognition_model, a.match_score, a.match_margin, a.review_reasons from public.attendance_events a join public.employees e on e.id = a.employee_id where a.organization_id = ${ORG}`;
await browser.close(); await new Promise((r) => server.httpServer.close(r)); await sql.end();
console.log(JSON.stringify({ outcome, challengeShown: await challengeShown, elapsedMs: elapsed, screen: name?.replace(/\s+/g, ' '), events: ev }, null, 1));
const policyActive = !process.env.POLICY || JSON.parse(process.env.POLICY).activeChallenge !== 0;
if (policyActive && outcome === 'PRUEBA_DE_VIDA_FALLIDA' && !(await challengeShown)) { console.log('FALLO: la instrucción del desafío nunca se mostró en pantalla'); process.exit(1); }
if (process.env.EXPECT_OUTCOME) {
  const ok = outcome === process.env.EXPECT_OUTCOME && ev.length === 0;
  console.log(ok ? `OK: resultado esperado ${outcome}, ninguna marcación registrada` : `FALLO: esperado ${process.env.EXPECT_OUTCOME}, obtenido ${outcome} con ${ev.length} eventos`);
  process.exit(ok ? 0 : 1);
}
if (process.env.NEGATIVE) {
  if (outcome !== 'NO_RECONOCIDO' || ev.length !== 0) { console.error('FALLO: persona no enrolada no fue rechazada'); process.exit(1); }
  console.log('OK: persona no enrolada rechazada («No reconocido»), sin registrar marcación'); process.exit(0);
}
if (outcome !== 'ENTRADA' || ev.length !== 1 || ev[0].recognition_model !== 'sface@2021dec' || ev[0].n !== process.env.EXPECT) { console.error('FALLO E2E facial'); process.exit(1); }
console.log(`OK: reconocido «${ev[0].n}» sin selección manual, ENTRADA sincronizada (score ${ev[0].match_score.toFixed(3)})`);
