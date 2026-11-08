import type { Ctx } from './context';

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
    .select('id, state, opened_at, closed_at, duration_seconds, needs_review, cross_store, in_event_id, out_event_id, employee_id, employees(employee_code, first_name, last_name), stores(code, name, timezone)')
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
