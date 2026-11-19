/**
 * Reportes con datos reales: marcaciones ingeridas por la función real de sincronización, tardanzas calculadas por la
 * base (horario + tolerancia), bajas y recontratación por las funciones del ciclo laboral y registros disciplinarios.
 * Los resultados esperados están calculados a mano a partir del escenario (no con el mismo código).
 * Se ejecuta con scripts/test-admin-reports.sh (DATABASE_URL). Se omite si no hay base de datos.
 */
import { afterAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import ExcelJS from 'exceljs';
import { computeDiscipline, computePunctuality, computeTurnover, type FlagRow, type PeriodRow, type RecordRow } from '../lib/reports-core';
import { toCsv, toXlsx } from '../lib/reports-export';

const URL_ = process.env.DATABASE_URL;
const d = URL_ ? describe : describe.skip;

const ORG = '72000000-0000-4000-8000-000000000000', REG = '72000000-0000-4000-8000-000000000001', S1 = '72000000-0000-4000-8000-000000000002';
const S2 = '72000000-0000-4000-8000-000000000003', DEV = '72000000-0000-4000-8000-000000000004', ADMIN = '72000000-0000-4000-8000-000000000005';
const SCHED = '72000000-0000-4000-8000-000000000006';
const E = (n: number) => `72000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;

d('reportes del panel con datos reales', () => {
  const sql = postgres(URL_!, { prepare: false, max: 1 });
  afterAll(async () => { await sql.end(); });
  const asAdmin = async <T>(fn: (tx: postgres.TransactionSql) => Promise<T>) => sql.begin(async (tx) => {
    await tx.unsafe('set local role authenticated');
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ADMIN, aal: 'aal2' })}, true)`;
    return fn(tx);
  });
  let seq = 1;
  const ev = (emp: number, type: 'IN' | 'OUT', at: string) => ({ id: crypto.randomUUID(), storeId: S1, employeeId: E(emp), eventType: type, deviceSeq: seq++,
    occurredAt: at, tzOffsetMin: -360, monotonicMs: seq, bootId: 'r', clockFlags: [], decisionFlags: [], capturedOffline: true, policyVersion: 1, appVersion: 't', signature: 'sig' });

  it('escenario de octubre 2026', async () => {
    // Guatemala = UTC-6: entrada programada 08:00 local = 14:00Z.
    await sql.unsafe(`
      insert into public.organizations (id, name) values ('${ORG}', 'Reportes S.A.');
      insert into public.regions (id, organization_id, country_code, name, timezone) values ('${REG}', '${ORG}', 'GT', 'Guatemala', 'America/Guatemala');
      insert into public.stores (id, organization_id, region_id, code, name, timezone) values
        ('${S1}', '${ORG}', '${REG}', 'R1', 'Tienda 1', 'America/Guatemala'), ('${S2}', '${ORG}', '${REG}', 'R2', 'Tienda 2', 'America/Guatemala');
      insert into public.employees (id, organization_id, employee_code, first_name, last_name, hired_on) values
        ('${E(1)}', '${ORG}', 'R01', 'Uno', 'Tarde', '2026-09-01'), ('${E(2)}', '${ORG}', 'R02', 'Dos', 'Puntual', '2026-09-01'),
        ('${E(3)}', '${ORG}', 'R03', 'Tres', 'Nuevo', '2026-10-10'), ('${E(4)}', '${ORG}', 'R04', 'Cuatro', 'Renuncia', '2026-09-01'),
        ('${E(5)}', '${ORG}', 'R05', 'Cinco', 'Despido', '2026-08-01');
      insert into public.employee_store_assignments (organization_id, employee_id, store_id, valid_from)
        select '${ORG}', id, '${S1}', '2026-08-01T00:00:00Z' from public.employees where organization_id = '${ORG}';
      insert into auth.users (id, email) values ('${ADMIN}', 'rep@x');
      insert into public.admins (user_id, display_name, email) values ('${ADMIN}', 'Admin Reportes', 'rep@x');
      insert into public.admin_role_grants (user_id, role, organization_id) values ('${ADMIN}', 'central_admin', '${ORG}');
      insert into public.devices (id, organization_id, store_id, label, status, activated_at) values ('${DEV}', '${ORG}', '${S1}', 'Tel R1', 'active', '2026-09-01T00:00:00Z');
    `);
    // Horario de la Tienda 1, solo del lunes 5 al viernes 9 de octubre: 08:00, tolerancia 5 min.
    await asAdmin(async (tx) => {
      await tx`insert into public.work_schedules (id, organization_id, name, tolerance_minutes) values (${SCHED}, ${ORG}, 'Mañana', 5)`;
      for (let w = 1; w <= 7; w++) await tx`insert into public.work_schedule_days (organization_id, schedule_id, weekday, start_time) values (${ORG}, ${SCHED}, ${w}, '08:00')`;
      await tx`insert into public.schedule_assignments (organization_id, schedule_id, store_id, valid_from, valid_to) values (${ORG}, ${SCHED}, ${S1}, '2026-10-05', '2026-10-09')`;
    });
    // Marcaciones (llegan offline, por la función real de ingesta):
    //  Uno: 5 oct 08:03 (en tolerancia), 6 oct 08:20 (+20), 7 oct 08:10 (+10), 8 oct 08:06 (+6), 9 oct sin marcar.
    //  Dos: 5 oct 08:00, 6–9 sin marcar.   Cuatro y Cinco: 5–9 oct 07:55 (puntuales).   Tres: ingresó el 10 (fuera del horario).
    const events = [
      ev(1, 'IN', '2026-10-05T14:03:00Z'), ev(1, 'OUT', '2026-10-05T22:00:00Z'), ev(1, 'IN', '2026-10-06T14:20:00Z'), ev(1, 'OUT', '2026-10-06T22:00:00Z'),
      ev(1, 'IN', '2026-10-07T14:10:00Z'), ev(1, 'OUT', '2026-10-07T22:00:00Z'), ev(1, 'IN', '2026-10-08T14:06:00Z'), ev(1, 'OUT', '2026-10-08T22:00:00Z'),
      ev(2, 'IN', '2026-10-05T14:00:00Z'), ev(2, 'OUT', '2026-10-05T22:00:00Z'),
      ...[4, 5].flatMap((n) => [5, 6, 7, 8, 9].flatMap((day) => [ev(n, 'IN', `2026-10-0${day}T13:55:00Z`), ev(n, 'OUT', `2026-10-0${day}T22:00:00Z`)])),
    ];
    await sql.begin(async (tx) => {
      await tx.unsafe('set local role service_role');
      await tx`select private.ingest_device_events(${DEV}::uuid, ${crypto.randomUUID()}::uuid, ${tx.json(events)}::jsonb)`;
    });
    // Bajas: Cuatro renuncia el 20/10; Cinco es despedido con fecha 31/10.
    await asAdmin((tx) => tx`select public.terminate_employee(${E(4)}::uuid, 'resignation', '2026-10-20', 'Renuncia por estudios', null, null, null)`);
    await asAdmin((tx) => tx`select public.terminate_employee(${E(5)}::uuid, 'dismissal', '2026-10-31', 'Incumplimiento reiterado', 'comentario', null, null)`);
    // Recalcular octubre (como hace el botón «Recalcular» del panel).
    await asAdmin((tx) => tx`select public.recompute_tardiness(${ORG}::uuid, '2026-10-01')`);
    // Disciplina: 2 llamadas de atención a Uno (una luego anulada), 1 reconocimiento a Dos.
    const [{ id: cat }] = await sql`select id from public.hr_catalog where organization_id = ${ORG} and label = 'Problemas de puntualidad'`;
    const recs = await asAdmin(async (tx) => {
      const [a] = await tx`select public.create_disciplinary_record(${E(1)}::uuid, 'disciplinary', '2026-10-08', ${cat}::uuid, 'verbal', 'Tres llegadas tarde en la semana', null, false, ${S1}::uuid) id`;
      const [b] = await tx`select public.create_disciplinary_record(${E(1)}::uuid, 'disciplinary', '2026-10-09', ${cat}::uuid, 'written', 'Registro duplicado por error', null, true, ${S1}::uuid) id`;
      await tx`select public.create_disciplinary_record(${E(2)}::uuid, 'recognition', '2026-10-15', null, null, 'Excelente atención al cliente', null, true, ${S2}::uuid)`;
      await tx`select public.void_disciplinary_record(${b!.id}::uuid, 'Registro duplicado por error de captura')`;
      return [a!.id, b!.id];
    });
    expect(recs).toHaveLength(2);

    // ---------- Datos con la misma forma que devuelve la API del panel ----------
    const periods = await sql<PeriodRow[]>`select employee_id::text, started_on::text, ended_on::text, end_type from public.employment_periods where organization_id = ${ORG}`;
    const flags = (store?: string) => sql<FlagRow[]>`select f.employee_id::text, f.kind, f.minutes_late, f.store_id::text, f.work_date::text,
        json_build_object('first_name', e.first_name, 'last_name', e.last_name, 'employee_code', e.employee_code) employees,
        case when s.id is null then null else json_build_object('code', s.code) end stores
      from public.attendance_day_flags f join public.employees e on e.id = f.employee_id left join public.stores s on s.id = f.store_id
      where f.organization_id = ${ORG} and f.work_date between '2026-10-01' and '2026-10-31' and (${store ?? null}::uuid is null or f.store_id = ${store ?? null}::uuid)
      order by f.work_date`;
    const records = (store?: string) => sql<RecordRow[]>`select r.incident_date::text, r.kind, r.measure, r.status, r.employee_informed,
        json_build_object('first_name', e.first_name, 'last_name', e.last_name, 'employee_code', e.employee_code) employees,
        case when c.id is null then null else json_build_object('label', c.label) end hr_catalog,
        case when s.id is null then null else json_build_object('code', s.code) end stores
      from public.disciplinary_records r join public.employees e on e.id = r.employee_id left join public.hr_catalog c on c.id = r.category_id
      left join public.stores s on s.id = r.store_id
      where r.organization_id = ${ORG} and r.incident_date between '2026-10-01' and '2026-10-31' and (${store ?? null}::uuid is null or r.store_id = ${store ?? null}::uuid)
      order by r.incident_date`;

    // ---------- Puntualidad ----------
    const p = computePunctuality(await flags());
    const row = (code: string) => p.rows.find((r) => r[0] === code);
    // Uno: tardanzas 20 + 10 + 6 = 36 min (la de 08:03 está dentro de la tolerancia), máximo 20, 1 día sin marcar (9 oct).
    expect(row('R01')).toEqual(['R01', 'Tarde, Uno', 'R1', 3, 36, 12, 20, 1]);
    // Dos: puntual el 5; del 6 al 9 tiene horario y no marcó → 4 días sin marcación.
    expect(row('R02')).toEqual(['R02', 'Puntual, Dos', 'R1', 0, 0, 0, 0, 4]);
    expect(row('R03')).toBeUndefined(); // ingresó después del horario: no se evalúa
    expect(row('R04')).toBeUndefined(); expect(row('R05')).toBeUndefined(); // puntuales
    expect(p.summary).toEqual(expect.arrayContaining([['Llegadas tarde', 3], ['Minutos tarde (total)', 36], ['Días con horario sin marcación', 5],
      ['Empleados con al menos una tardanza', 1]]));
    expect(computePunctuality(await flags(S2)).rows).toHaveLength(0); // filtro por sucursal
    // Exportaciones: el CSV y el Excel contienen exactamente esas cifras.
    const csv = toCsv(p).replace('\uFEFF', '').split('\r\n');
    expect(csv[0]).toBe('codigo,empleado,sucursal,llegadas_tarde,minutos_tarde_total,promedio_minutos,maximo_minutos,dias_sin_marcacion');
    expect(csv).toContain('R01,"Tarde, Uno",R1,3,36,12,20,1');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await toXlsx(p, '2026-10-01', '2026-10-31'));
    const ws = wb.getWorksheet('Puntualidad')!;
    const xr = [2, 3].map((i) => (ws.getRow(i).values as unknown[]).slice(1)).find((v) => v[0] === 'R01');
    expect(xr).toEqual(['R01', 'Tarde, Uno', 'R1', 3, 36, 12, 20, 1]);
    expect((wb.getWorksheet('Resumen')!.getRow(2).values as unknown[]).slice(1)).toEqual(['Llegadas tarde', 3]);

    // La alerta mensual (umbral 3) existe una sola vez con 3 tardanzas.
    const alerts = await sql`select count, status from public.alerts where organization_id = ${ORG} and employee_id = ${E(1)}`;
    expect(alerts).toEqual([{ count: 3, status: 'pending' }]);

    // ---------- Rotación ----------
    const t = computeTurnover(periods, { org: ORG, from: '2026-10-01', to: '2026-10-31' });
    // 1 oct: Uno, Dos, Cuatro, Cinco = 4. 31 oct: Uno, Dos, Tres, Cinco (su baja es ese mismo día) = 4.
    // Altas: Tres. Bajas: Cuatro (renuncia) y Cinco (despido). Rotación = 2 / 4 × 100 = 50 %.
    expect(t.rows).toEqual([['2026-10', 4, 1, 2, 1, 1, 4, 50]]);
    const s = computeTurnover(periods, { org: ORG, from: '2026-09-01', to: '2026-11-30' });
    // Sep: 1 sep: Cinco (desde ago) = 1… se contratan Uno, Dos, Cuatro el 1 sep → 1 sep ya cuentan: inicial 4, final 4, sin bajas.
    expect(s.rows[0]).toEqual(['2026-09', 4, 3, 0, 0, 0, 4, 0]);
    // Nov: inicial = Uno, Dos, Tres = 3; final 3; sin movimientos.
    expect(s.rows[2]).toEqual(['2026-11', 3, 0, 0, 0, 0, 3, 0]);

    // Recontratación de Cuatro el 3 nov: nuevo período, cuenta como alta de noviembre.
    await asAdmin((tx) => tx`select public.rehire_employee(${E(4)}::uuid, '2026-11-03', ${S1}::uuid, 'Regresa')`);
    const periods2 = await sql<PeriodRow[]>`select employee_id::text, started_on::text, ended_on::text, end_type from public.employment_periods where organization_id = ${ORG}`;
    expect(periods2.filter((x) => x.employee_id === E(4))).toHaveLength(2);
    const nov = computeTurnover(periods2, { org: ORG, from: '2026-11-01', to: '2026-11-30' });
    expect(nov.rows).toEqual([['2026-11', 3, 1, 0, 0, 0, 4, 0]]);

    // ---------- Disciplina ----------
    const dsc = computeDiscipline(await records());
    expect(dsc.rows).toHaveLength(3); // el anulado se lista
    expect(dsc.rows.find((r) => r[5] === 'Llamada de atención escrita')?.[7]).toBe('Anulado');
    expect(dsc.summary).toEqual(expect.arrayContaining([['Registros disciplinarios', 1], ['Reconocimientos', 1], ['Abiertos (pendiente / en revisión)', 1],
      ['Anulados', 1], ['Categoría: Problemas de puntualidad', 1]]));
    expect(computeDiscipline(await records(S2)).rows).toEqual([['2026-10-15', 'R02', 'Puntual, Dos', 'R2', 'Reconocimiento', '', '', 'Cerrado', 'sí']]);
  });
});
