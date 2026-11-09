// Prueba de integración: handler real + funciones SQL reales sobre un Postgres local (scripts/test-edge.sh).
import postgres from 'postgres';
import { createDb } from './db.ts';
import { createHandler, activationProofBytes } from './handler.ts';
import { generateDeviceKeyPair, signEvent, signRequest, b64urlEncode, b64urlDecode, PROTOCOL_VERSION, type AttendanceEventPayload } from '../_shared/core/index.ts';
import { ed25519 } from '@noble/curves/ed25519.js';

const URL_ = Deno.env.get('DATABASE_URL')!;
const sql = postgres(URL_, { prepare: false, max: 1 });
const db = createDb(URL_);
const handler = createHandler(db);
const call = (route: string, body: unknown, headers: Record<string, string> = {}) =>
  handler(new Request(`http://local/device-api/${route}`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers }));
function assert(c: unknown, m: string) { if (!c) throw new Error('FALLO: ' + m); }

const ORG = '11111111-0000-4000-8000-000000000000', REG = '11111111-0000-4000-8000-000000000001';
const HQ = '11111111-0000-4000-8000-000000000002', STORE = '11111111-0000-4000-8000-000000000003';
const EMP = '11111111-0000-4000-8000-000000000004', DEV = '11111111-0000-4000-8000-000000000005';
const ADMIN = '11111111-0000-4000-8000-000000000006', MODEL = '11111111-0000-4000-8000-000000000007';
const CONSENT = '11111111-0000-4000-8000-000000000008';
const CODE = 'ABCD-EFGH-JKMN';

async function seed() {
  await sql.unsafe(`
    insert into public.organizations (id, name) values ('${ORG}', 'Cisternas');
    insert into public.regions (id, organization_id, country_code, name, timezone) values ('${REG}', '${ORG}', 'GT', 'Guatemala', 'America/Guatemala');
    insert into public.stores (id, organization_id, region_id, code, name, timezone, is_central) values
      ('${HQ}', '${ORG}', '${REG}', 'HQ', 'Sede central', 'America/Guatemala', true),
      ('${STORE}', '${ORG}', '${REG}', 'S1', 'Sucursal 1', 'America/Guatemala', false);
    insert into public.employees (id, organization_id, employee_code, first_name, last_name) values ('${EMP}', '${ORG}', '001', 'María', 'López');
    insert into public.employee_store_assignments (organization_id, employee_id, store_id, valid_from) values ('${ORG}', '${EMP}', '${STORE}', now() - interval '1 day');
    insert into auth.users (id, email) values ('${ADMIN}', 'admin@cisternas');
    insert into public.admins (user_id, display_name, email) values ('${ADMIN}', 'Admin', 'admin@cisternas');
    insert into public.admin_role_grants (user_id, role, organization_id) values ('${ADMIN}', 'central_admin', '${ORG}');
    insert into public.model_versions (id, kind, name, version, license, embedding_dim) values ('${MODEL}', 'recognition', 'test', '0', 'TEST', 4);
    insert into public.biometric_consents (id, organization_id, employee_id, legal_basis, notice_version, accepted_at, recorded_by)
      values ('${CONSENT}', '${ORG}', '${EMP}', 'consentimiento_expreso', 'v1', now(), '${ADMIN}');
    insert into public.devices (id, organization_id, store_id, label) values ('${DEV}', '${ORG}', '${STORE}', 'Teléfono S1');
    insert into public.device_enrollments (organization_id, device_id, code_hash, expires_at)
      values ('${ORG}', '${DEV}', encode(extensions.digest('ABCDEFGHJKMN', 'sha256'), 'hex'), now() + interval '30 minutes');
  `);
  const vec = b64urlEncode(new Uint8Array(new Float32Array([0.5, 0.5, 0.5, 0.5]).buffer));
  await sql.begin(async (tx) => {
    await tx.unsafe(`set local role authenticated`);
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ADMIN, aal: 'aal2' })}, true)`;
    await tx`select public.set_employee_document(${EMP}::uuid, 'DPI', 'GT', '1234567890123', 'prueba automatizada')`;
    await tx`select public.verify_employee_document(${EMP}::uuid, '1234567890123')`;
    await tx`select public.enroll_biometric(${EMP}::uuid, ${CONSENT}::uuid, ${HQ}::uuid, 'documento_presencial',
      ${tx.array([vec, vec, vec])}::text[], '{}'::jsonb, true, 0.97, ${MODEL}::uuid, null)`;
  });
}

async function signedCall(route: 'push' | 'pull', body: unknown, privateKey: string, deviceId = DEV) {
  const ch = await (await call('challenge', { deviceId })).json();
  const text = JSON.stringify(body);
  const sig = signRequest('POST', route, ch.challenge, text, privateKey);
  return { res: await call(route, text, { 'x-device-id': deviceId, 'x-challenge': ch.challenge, 'x-signature': sig }), challenge: ch.challenge, text, sig };
}

Deno.test('flujo completo del dispositivo', async (t) => {
  await seed();
  const kp = generateDeviceKeyPair();
  const proof = (code: string) => b64urlEncode(ed25519.sign(activationProofBytes(code, kp.publicKey), b64urlDecode(kp.privateKey)));

  await t.step('activación rechaza prueba de posesión falsa', async () => {
    const other = generateDeviceKeyPair();
    const bad = b64urlEncode(ed25519.sign(activationProofBytes(CODE, kp.publicKey), b64urlDecode(other.privateKey)));
    const r = await call('activate', { code: CODE, publicKey: kp.publicKey, platform: 'android', proof: bad });
    assert(r.status === 400 && (await r.json()).error === 'invalid_proof', 'prueba falsa');
  });
  await t.step('activación con código y prueba válidos', async () => {
    const r = await call('activate', { code: CODE, publicKey: kp.publicKey, platform: 'android', proof: proof(CODE), osVersion: '14', appVersion: '0.1.0', hardwareModel: 'Pixel', keyStorage: 'android_keystore' });
    const j = await r.json();
    assert(r.status === 200 && j.ok && j.deviceId === DEV && j.nextDeviceSeq === 1, 'activación ' + JSON.stringify(j));
  });
  await t.step('pull devuelve roster con plantilla y sin política calibrada', async () => {
    const { res } = await signedCall('pull', { protocol: PROTOCOL_VERSION, knownEmployeeIds: [] }, kp.privateKey);
    const j = await res.json();
    assert(res.status === 200 && j.roster.length === 1 && j.roster[0].displayName === 'María L.' && j.roster[0].templates.length === 3, 'roster ' + JSON.stringify(j).slice(0, 300));
    assert(j.device.storeId === STORE && j.policy === null, 'device/policy');
  });
  await t.step('desafío reutilizado o firma inválida → 401', async () => {
    const { challenge, text, sig } = await signedCall('pull', { protocol: PROTOCOL_VERSION, knownEmployeeIds: [] }, kp.privateKey);
    const replay = await call('pull', text, { 'x-device-id': DEV, 'x-challenge': challenge, 'x-signature': sig });
    assert(replay.status === 401, 'replay');
    const intruder = generateDeviceKeyPair();
    const { res } = await signedCall('pull', { protocol: PROTOCOL_VERSION, knownEmployeeIds: [] }, intruder.privateKey);
    assert(res.status === 401, 'firma de otra clave');
  });

  const base: Omit<AttendanceEventPayload, 'id' | 'deviceSeq' | 'eventType' | 'occurredAt'> = {
    deviceId: DEV, storeId: STORE, employeeId: EMP, tzOffsetMin: -360, monotonicMs: 1000, bootId: 'boot1',
    lastServerTime: new Date().toISOString(), estClockOffsetMs: 0, clockFlags: [], decisionFlags: [], capturedOffline: true,
    matchScore: 0.8, matchMargin: 0.3, padScore: 0.9, recognitionModel: 'test@0', padModel: null, policyVersion: 1, appVersion: '0.1.0',
  };
  const now = Date.now();
  const e1 = signEvent({ ...base, id: crypto.randomUUID(), deviceSeq: 1, eventType: 'IN', occurredAt: new Date(now - 8 * 3600e3).toISOString() }, kp.privateKey);
  const e2 = signEvent({ ...base, id: crypto.randomUUID(), deviceSeq: 2, eventType: 'OUT', occurredAt: new Date(now - 60e3).toISOString() }, kp.privateKey);
  const tampered = { ...signEvent({ ...base, id: crypto.randomUUID(), deviceSeq: 3, eventType: 'IN', occurredAt: new Date(now - 30e3).toISOString() }, kp.privateKey), eventType: 'OUT' as const };
  const health = { pendingEvents: 3, batteryPct: 80, freeStorageMb: 2000, appVersion: '0.1.0', osVersion: '14', recognitionModel: 'test@0', padModel: null, clockOffsetMs: 0, flags: [] };
  const batchId = crypto.randomUUID();

  await t.step('push: eventos firmados aceptados, manipulado rechazado', async () => {
    const { res } = await signedCall('push', { protocol: PROTOCOL_VERSION, batchId, events: [e1, e2, tampered], health }, kp.privateKey);
    const j = await res.json();
    const by = Object.fromEntries(j.acks.map((a: { eventId: string; result: string }) => [a.eventId, a.result]));
    assert(res.status === 200 && by[e1.id] === 'accepted' && by[e2.id] === 'accepted' && by[tampered.id] === 'rejected', 'acks ' + JSON.stringify(j));
  });
  await t.step('reintento del mismo lote es idempotente', async () => {
    const { res } = await signedCall('push', { protocol: PROTOCOL_VERSION, batchId, events: [e1, e2, tampered], health }, kp.privateKey);
    const j = await res.json();
    assert(j.acks.length === 3, 'mismos acuses');
    const [{ n }] = await sql`select count(*)::int n from public.attendance_events where employee_id = ${EMP}`;
    assert(n === 2, 'sin duplicados: ' + n);
    const [{ d }] = await sql`select duration_seconds d from public.attendance_sessions where employee_id = ${EMP} and state = 'closed'`;
    assert(Math.abs(Number(d) - (8 * 3600 - 60)) < 2, 'permanencia calculada ' + d);
  });
  await t.step('evento de otro dispositivo dentro del lote → rechazado', async () => {
    const forged = signEvent({ ...base, deviceId: crypto.randomUUID(), id: crypto.randomUUID(), deviceSeq: 4, eventType: 'IN', occurredAt: new Date().toISOString() }, kp.privateKey);
    const { res } = await signedCall('push', { protocol: PROTOCOL_VERSION, batchId: crypto.randomUUID(), events: [forged], health }, kp.privateKey);
    assert((await res.json()).acks[0].result === 'rejected', 'deviceId ajeno');
  });
  await t.step('salud del dispositivo registrada', async () => {
    const [{ n }] = await sql`select count(*)::int n from public.device_health where device_id = ${DEV}`;
    assert(n >= 2, 'device_health');
  });
  await t.step('dispositivo bloqueado → sin desafío', async () => {
    await sql`update public.devices set status = 'blocked' where id = ${DEV}`;
    const r = await call('challenge', { deviceId: DEV });
    assert(r.status === 403, 'bloqueado');
  });
  await sql.end();
  await db.close();
});
