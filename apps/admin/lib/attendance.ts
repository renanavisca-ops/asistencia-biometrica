import type { Ctx } from './context';
import { DEFAULT_POLICY, summarizeWorkdays, type Workday } from '@asistencia/core';

export type Filters = { org: string; from: string; to: string; store?: string; employee?: string };

export function defaultRange(sp: Record<string, string | undefined>) {
  const to = sp.to ?? new Date().toISOString().slice(0, 10);
  const from = sp.from ?? new Date(Date.now() - 6 * 86400e3).toISOString().slice(0, 10);
  return { from, to };
}

/** Sesiones (pares entrada/salida) filtradas. RLS limita a las sedes visibles para el usuario. */
export async function querySessions(sb: Ctx['supabase'], f: Filters, limit = 1000) {
  const end = new Date(f.to + 'T00:00:00Z'); end.setUTCDate(end.getUTCDate() + 1);
  let q = sb.from('attendance_sessions')
    .select('id, state, opened_at, closed_at, duration_seconds, needs_review, cross_store, out_kind, in_event_id, out_event_id, employee_id, employees(employee_code, first_name, last_name), stores(code, name, timezone)')
    .eq('organization_id', f.org)
    .or(`and(opened_at.gte.${f.from}T00:00:00Z,opened_at.lt.${end.toISOString()}),and(opened_at.is.null,closed_at.gte.${f.from}T00:00:00Z,closed_at.lt.${end.toISOString()})`)
    .order('opened_at', { ascending: false, nullsFirst: false }).limit(limit);
  if (f.store) q = q.eq('store_id', f.store);
  if (f.employee) q = q.eq('employee_id', f.employee);
  return q;
}

export async function queryEvents(sb: Ctx['supabase'], f: Filters, limit = 5000) {
  const end = new Date(f.to + 'T00:00:00Z'); end.setUTCDate(end.getUTCDate() + 1);
  let q = sb.from('attendance_events')
    .select('id, event_type, occurred_at, received_at, status, review_reasons, source, captured_offline, clock_flags, device_seq, employees(employee_code, first_name, last_name), stores(code, name), devices(label)')
    .eq('organization_id', f.org).gte('occurred_at', `${f.from}T00:00:00Z`).lt('occurred_at', end.toISOString())
    .order('occurred_at', { ascending: false }).limit(limit);
  if (f.store) q = q.eq('store_id', f.store);
  if (f.employee) q = q.eq('employee_id', f.employee);
  return q;
}

export type SessionRow = {
  id: string; state: 'open' | 'closed' | 'missing_out' | 'orphan_out'; opened_at: string | null; closed_at: string | null;
  needs_review: boolean; employee_id: string; out_kind: 'break' | 'end' | null;
  employees: { employee_code: string; first_name: string; last_name: string };
  stores: { code: string; name: string; timezone: string };
};

/** Política vigente de la organización (rango de pausas). */
export async function orgPolicy(sb: Ctx['supabase'], org: string) {
  const { data } = await sb.from('device_policy_versions').select('policy').eq('organization_id', org).order('version', { ascending: false }).limit(1).maybeSingle();
  const p = { ...DEFAULT_POLICY, ...((data?.policy as Record<string, number>) ?? {}) };
  return { pauseMinMinutes: Number(p.pauseMinMinutes), pauseMaxMinutes: Number(p.pauseMaxMinutes) };
}

export type WorkdayRow = Workday & { employee: SessionRow['employees']; store: SessionRow['stores'] };

/** Resumen por jornada; cada grupo de zona horaria se resume con su propia zona. */
export function workdaysFrom(rows: SessionRow[], pol: { pauseMinMinutes: number; pauseMaxMinutes: number }): WorkdayRow[] {
  const meta = new Map(rows.map((r) => [r.employee_id, r]));
  const byTz = new Map<string, SessionRow[]>();
  for (const r of rows) (byTz.get(r.stores.timezone) ?? byTz.set(r.stores.timezone, []).get(r.stores.timezone)!).push(r);
  const out: WorkdayRow[] = [];
  for (const [tz, list] of byTz) {
    const days = summarizeWorkdays(list.map((r) => ({
      employeeId: r.employee_id, openedAtMs: r.opened_at ? Date.parse(r.opened_at) : null, closedAtMs: r.closed_at ? Date.parse(r.closed_at) : null,
      state: r.state, needsReview: r.needs_review, outKind: r.out_kind,
    })), { timeZone: tz, ...pol });
    for (const d of days) out.push({ ...d, employee: meta.get(d.employeeId)!.employees, store: meta.get(d.employeeId)!.stores });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.employee.last_name.localeCompare(b.employee.last_name));
}
