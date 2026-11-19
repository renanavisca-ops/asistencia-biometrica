/**
 * Horario semanal de punta a punta: plantilla Excel → llenado → lectura → import_weekly_schedule (función real, como
 * administración central) → vista semanal y tardanzas recalculadas. Requiere DATABASE_URL (scripts/test-admin-reports.sh).
 */
import { afterAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import ExcelJS from 'exceljs';
import { buildTemplate, parseWeekly, toRpcRows } from '../lib/weekly';

const URL_ = process.env.DATABASE_URL;
const d = URL_ ? describe : describe.skip;
const ORG = '73000000-0000-4000-8000-000000000000', REG = '73000000-0000-4000-8000-000000000001', ST = '73000000-0000-4000-8000-000000000002';
const ADMIN = '73000000-0000-4000-8000-000000000003', SUP = '73000000-0000-4000-8000-000000000004', DEV = '73000000-0000-4000-8000-000000000005';
const E1 = '73000000-0000-4000-8000-000000000011', E2 = '73000000-0000-4000-8000-000000000012';

d('horario semanal desde Excel', () => {
  const sql = postgres(URL_!, { prepare: false, max: 1 });
  afterAll(async () => { await sql.end(); });
  const as = async <T>(uid: string, fn: (tx: postgres.TransactionSql) => Promise<T>) => sql.begin(async (tx) => {
    await tx.unsafe('set local role authenticated');
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, aal: 'aal2' })}, true)`;
    return fn(tx);
  });

  it('importa la semana y recalcula tardanzas', async () => {
    await sql.unsafe(`
      insert into public.organizations (id, name) values ('${ORG}', 'Semanal S.A.');
      insert into public.regions (id, organization_id, country_code, name, timezone) values ('${REG}', '${ORG}', 'GT', 'GT', 'America/Guatemala');
      insert into public.stores (id, organization_id, region_id, code, name, timezone) values ('${ST}', '${ORG}', '${REG}', 'W1', 'Tienda Semanal', 'America/Guatemala');
      insert into public.employees (id, organization_id, employee_code, first_name, last_name, hired_on) values
        ('${E1}', '${ORG}', 'W01', 'Ana', 'Pérez', '2026-09-01'), ('${E2}', '${ORG}', 'W02', 'Luis', 'Gómez', '2026-09-01');
      insert into public.employee_store_assignments (organization_id, employee_id, store_id, valid_from)
        values ('${ORG}', '${E1}', '${ST}', '2026-09-01T00:00:00Z'), ('${ORG}', '${E2}', '${ST}', '2026-09-01T00:00:00Z');
      insert into auth.users (id, email) values ('${ADMIN}', 'w@x'), ('${SUP}', 'ws@x');
      insert into public.admins (user_id, display_name, email) values ('${ADMIN}', 'Admin W', 'w@x'), ('${SUP}', 'Sup W', 'ws@x');
      insert into public.admin_role_grants (user_id, role, organization_id) values ('${ADMIN}', 'central_admin', '${ORG}');
      insert into public.admin_role_grants (user_id, role, organization_id, store_id) values ('${SUP}', 'supervisor', '${ORG}', '${ST}');
      insert into public.devices (id, organization_id, store_id, label, status, activated_at) values ('${DEV}', '${ORG}', '${ST}', 'Tel W1', 'active', '2026-09-01');
    `);
    // Ana entra el lunes 5 oct a las 08:12 (Guatemala = UTC-6).
    await sql.begin(async (tx) => {
      await tx.unsafe('set local role service_role');
      await tx`select private.ingest_device_events(${DEV}::uuid, ${crypto.randomUUID()}::uuid, ${tx.json([{ id: crypto.randomUUID(), storeId: ST, employeeId: E1, eventType: 'IN',
        deviceSeq: 1, occurredAt: '2026-10-05T14:12:00Z', tzOffsetMin: -360, monotonicMs: 1, bootId: 'w', clockFlags: [], decisionFlags: [], capturedOffline: false,
        policyVersion: 1, appVersion: 't', signature: 'sig' }])}::jsonb)`;
    });
    // Plantilla de la semana del lunes 5 de octubre, llenada como lo haría la tienda.
    const tpl = await buildTemplate({ storeCode: 'W1', weekStart: '2026-10-05', tolerance: 10,
      employees: [{ code: 'W01', name: 'Pérez, Ana', days: {} }, { code: 'W02', name: 'Gómez, Luis', days: {} }] });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(tpl);
    const ws = wb.getWorksheet('Horario')!;
    ws.getCell('C6').value = '8:00'; ws.getCell('D6').value = '4:00 pm';   // Ana lunes 08:00–16:00
    ws.getCell('E7').value = '13:00'; ws.getCell('F7').value = '21:00';    // Luis martes 13:00–21:00
    const parsed = await parseWeekly((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // La supervisora no puede cargar horarios; la administración central sí.
    await expect(as(SUP, (tx) => tx`select public.import_weekly_schedule(${ST}::uuid, '2026-10-05', 10, ${tx.json(toRpcRows(parsed.sheet))}::jsonb)`)).rejects.toThrow(/permiso/);
    const [{ r }] = await as(ADMIN, (tx) => tx`select public.import_weekly_schedule(${ST}::uuid, ${parsed.sheet.weekStart}::date, ${parsed.sheet.tolerance}, ${tx.json(toRpcRows(parsed.sheet))}::jsonb) r`);
    expect(r).toEqual({ employees: 2, schedules: 2 });
    const week = await as(SUP, (tx) => tx`select employee_code, weekday, start_time::text, end_time::text, kind from public.store_week_schedule(${ST}::uuid, '2026-10-05') where kind = 'scheduled' order by 1, 2`);
    expect(week).toEqual([
      { employee_code: 'W01', weekday: 1, start_time: '08:00:00', end_time: '16:00:00', kind: 'scheduled' },
      { employee_code: 'W02', weekday: 2, start_time: '13:00:00', end_time: '21:00:00', kind: 'scheduled' },
    ]);
    // Ana entró 08:12 con tolerancia 10 → tarde 12 min. Luis no marcó el martes → sin marcación. Nada más esa semana.
    const flags = await sql`select e.employee_code, f.work_date::text, f.kind, f.minutes_late from public.attendance_day_flags f join public.employees e on e.id = f.employee_id
      where f.organization_id = ${ORG} order by 1, 2`;
    expect(flags).toEqual([
      { employee_code: 'W01', work_date: '2026-10-05', kind: 'late', minutes_late: 12 },
      { employee_code: 'W02', work_date: '2026-10-06', kind: 'no_show', minutes_late: null },
    ]);
  });
});
