/**
 * Extremo a extremo: KioskService real → Edge Function device-api real (handler) → Postgres real con las migraciones.
 * Se ejecuta con scripts/test-kiosk-e2e.sh (DATABASE_URL). Se omite si no hay base de datos.
 */
import { describe, expect, it, afterAll } from 'vitest';
import postgres from 'postgres';
import { createHandler } from '../../../supabase/functions/device-api/handler.ts';
import { createDb } from '../../../supabase/functions/device-api/db.ts';
import { KioskService } from '../src/domain/kiosk.ts';
import { DeviceApi, type Fetch } from '../src/domain/http.ts';
import { MemoryStore } from '../src/domain/store.ts';
import { FakePlatform } from './helpers.ts';

const URL_ = process.env.DATABASE_URL;
const d = URL_ ? describe : describe.skip;

const ORG = '41111111-0000-4000-8000-000000000000', REG = '41111111-0000-4000-8000-000000000001';
const HQ = '41111111-0000-4000-8000-000000000002', S1 = '41111111-0000-4000-8000-000000000003', S2 = '41111111-0000-4000-8000-00000000000a';
const ANA = '41111111-0000-4000-8000-000000000004', LUIS = '41111111-0000-4000-8000-000000000009';
const DEV = '41111111-0000-4000-8000-000000000005', DEV2 = '41111111-0000-4000-8000-00000000000b';
const ADMIN = '41111111-0000-4000-8000-000000000006', MODEL = '41111111-0000-4000-8000-000000000007';

d('kiosk ↔ device-api ↔ Postgres', () => {
  const sql = postgres(URL_!, { prepare: false, max: 1 });
  const db = createDb(URL_!);
  const handler = createHandler(db);
  let online = true;
  let dropNextResponse = false;
  const fetchFn: Fetch = async (url, init) => {
    if (!online) throw new Error('offline');
    const res = await handler(new Request(url, { method: init.method, headers: init.headers, body: init.body }));
    if (dropNextResponse && url.endsWith('/push')) { dropNextResponse = false; throw new Error('conexión cortada tras enviar'); }
    return { status: res.status, json: () => res.json() };
  };
  const mk = () => {
    const store = new MemoryStore(); const platform = new FakePlatform();
    platform.wall = Date.now() - 20 * 3_600_000; // el escenario empieza hace 20 h para no producir horas futuras
    return { store, platform, svc: new KioskService(store, new DeviceApi('http://local/device-api', fetchFn), platform) };
  };
  afterAll(async () => { await sql.end(); await db.close(); });

  const code = async (device: string) => {
    const c = 'TEST' + Math.random().toString(36).slice(2, 10).toUpperCase().replace(/[^A-Z0-9]/g, 'X');
    await sql`insert into public.device_enrollments (organization_id, device_id, code_hash, expires_at)
      values (${ORG}, ${device}, encode(extensions.digest(${c}, 'sha256'), 'hex'), now() + interval '30 minutes')`;
    return c;
  };
  const asAdmin = async <T>(fn: (tx: postgres.TransactionSql) => Promise<T>) => sql.begin(async (tx) => {
    await tx.unsafe('set local role authenticated');
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ADMIN, aal: 'aal2' })}, true)`;
    return fn(tx);
  });

  it('flujo completo de una tienda', async () => {
    await sql.unsafe(`
      insert into public.organizations (id, name) values ('${ORG}', 'Cisternas');
      insert into public.regions (id, organization_id, country_code, name, timezone) values ('${REG}', '${ORG}', 'GT', 'Guatemala', 'America/Guatemala');
      insert into public.stores (id, organization_id, region_id, code, name, timezone, is_central) values
        ('${HQ}', '${ORG}', '${REG}', 'HQ', 'Central', 'America/Guatemala', true),
        ('${S1}', '${ORG}', '${REG}', 'S1', 'Sucursal 1', 'America/Guatemala', false),
        ('${S2}', '${ORG}', '${REG}', 'S2', 'Sucursal 2', 'America/Guatemala', false);
      insert into public.employees (id, organization_id, employee_code, first_name, last_name) values
        ('${ANA}', '${ORG}', '001', 'Ana', 'Pérez'), ('${LUIS}', '${ORG}', '002', 'Luis', 'Gómez');
      insert into public.employee_store_assignments (organization_id, employee_id, store_id, valid_from) values
        ('${ORG}', '${ANA}', '${S1}', now() - interval '30 days'), ('${ORG}', '${LUIS}', '${S1}', now() - interval '30 days');
      insert into auth.users (id, email) values ('${ADMIN}', 'a@x');
      insert into public.admins (user_id, display_name, email) values ('${ADMIN}', 'Admin', 'a@x');
      insert into public.admin_role_grants (user_id, role, organization_id) values ('${ADMIN}', 'central_admin', '${ORG}');
      insert into public.model_versions (id, kind, name, version, license, embedding_dim) values ('${MODEL}', 'recognition', 'SIMULADO', '0', 'TEST', 4);
      insert into public.devices (id, organization_id, store_id, label) values ('${DEV}', '${ORG}', '${S1}', 'Tel S1'), ('${DEV2}', '${ORG}', '${S1}', 'Tel S1 bis');
    `);
    // Enrolamiento central (sede HQ) de ambos empleados.
    const vec = Buffer.from(new Float32Array([0.5, 0.5, 0.5, 0.5]).buffer).toString('base64');
    for (const e of [ANA, LUIS]) {
      await asAdmin(async (tx) => {
        const [c] = await tx`insert into public.biometric_consents (organization_id, employee_id, legal_basis, notice_version, accepted_at, recorded_by)
          values (${ORG}, ${e}, 'consentimiento_expreso', 'v1', now(), ${ADMIN}) returning id`;
        const doc = e === ANA ? '1111111111111' : '2222222222222';
        await tx`select public.set_employee_document(${e}::uuid, 'DPI', 'GT', ${doc}, 'prueba automatizada')`;
        await tx`select public.verify_employee_document(${e}::uuid, ${doc})`;
        await tx`select public.enroll_biometric(${e}::uuid, ${c!.id}::uuid, ${HQ}::uuid, 'documento', ${tx.array([vec, vec, vec])}::text[], '{}'::jsonb, true, 0.9, ${MODEL}::uuid, null)`;
      });
    }

    const A = mk();
    // 1. Activación + primera sincronización: el teléfono recibe a ambos empleados.
    expect(await A.svc.activate(await code(DEV))).toEqual({ ok: true });
    expect(await A.svc.activate('XXXX')).toEqual({ ok: false, error: 'already_activated' });
    const s1 = await A.svc.sync();
    expect(s1).toMatchObject({ ok: true, rosterSize: 2, deviceStatus: 'active' });
    expect(A.store.roster.map((r) => r.displayName).sort()).toEqual(['Ana P.', 'Luis G.']);

    // 2. Sin internet: Ana entra; 8 h después sale. Luis entra.
    online = false;
    const id = (employeeId: string) => ({ employeeId, matchScore: null, matchMargin: null, padScore: null, recognitionModel: 'SIMULADO@0', padModel: null });
    expect(await A.svc.punch(id(ANA))).toMatchObject({ kind: 'recorded', eventType: 'IN' });
    A.platform.advance(60_000);
    expect(await A.svc.punch(id(LUIS))).toMatchObject({ kind: 'recorded', eventType: 'IN' });
    A.platform.advance(8 * 3_600_000);
    expect(await A.svc.punch(id(ANA), { outKind: 'end' })).toMatchObject({ kind: 'recorded', eventType: 'OUT' });
    expect((await A.svc.sync()).ok).toBe(false);
    expect((await A.store.counts()).pending).toBe(3);

    // 3. Vuelve la red pero la respuesta del push se pierde: el reintento no duplica nada.
    online = true; dropNextResponse = true;
    expect((await A.svc.sync()).ok).toBe(false);
    const s3 = await A.svc.sync();
    expect(s3).toMatchObject({ ok: true });
    expect((await A.store.counts())).toMatchObject({ pending: 0 });
    const [{ n }] = await sql`select count(*)::int n from public.attendance_events where device_id = ${DEV}`;
    expect(n).toBe(3);
    const [{ d: dur }] = await sql`select duration_seconds d from public.attendance_sessions where employee_id = ${ANA} and state = 'closed'`;
    expect(Math.abs(Number(dur) - (8 * 3600 + 60))).toBeLessThan(2);

    // 4. Segundo teléfono de la misma tienda: continúa la alternancia de Luis (SALIDA) gracias al roster.
    const B = mk(); B.platform.wall = A.platform.wall + 60_000;
    await B.svc.activate(await code(DEV2)); await B.svc.sync();
    expect(await B.svc.punch(id(LUIS))).toMatchObject({ kind: 'choose_out' });
    expect(await B.svc.punch(id(LUIS), { outKind: 'end' })).toMatchObject({ kind: 'recorded', eventType: 'OUT' });
    expect(await B.svc.sync()).toMatchObject({ ok: true, acks: { accepted: 1 } });

    // 5. Traslado de Luis a S2: el teléfono de S1 lo elimina en la siguiente sincronización.
    await asAdmin((tx) => tx`select public.transfer_employee(${LUIS}::uuid, ${S2}::uuid, 'permanent', now(), null, 'Traslado de prueba')`);
    expect(await A.svc.sync()).toMatchObject({ ok: true, rosterSize: 1, revoked: 1 });
    expect(await A.svc.punch(id(LUIS))).toEqual({ kind: 'refused', reason: 'unknown_employee' });

    // 6. Bloqueo del teléfono A: borra roster local y deja de marcar.
    await asAdmin((tx) => tx`select public.set_device_status(${DEV}::uuid, 'blocked', 'Teléfono extraviado')`);
    expect(await A.svc.sync()).toEqual({ ok: false, error: 'device_blocked', retryable: false });
    expect(A.store.roster.length).toBe(0);
    expect(await A.svc.punch(id(ANA))).toEqual({ kind: 'refused', reason: 'blocked' });
  });
});
