import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeDiscipline, computePunctuality, computeTurnover, type FlagRow, type PeriodRow, type RecordRow, type Report, type ReportFilter, type ReportType } from './reports-core';

export type { Report, ReportFilter, ReportType } from './reports-core';

type Res<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** Lee todas las filas paginando (PostgREST devuelve como máximo 1000 por consulta). RLS limita lo visible. */
async function all<T>(q: (from: number, to: number) => Res<T>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < 50; i++) {
    const { data, error } = await q(i * 1000, i * 1000 + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function turnover(sb: SupabaseClient, f: ReportFilter): Promise<Report> {
  const periods = await all<PeriodRow>((a, b) => sb.from('employment_periods').select('employee_id, started_on, ended_on, end_type')
    .eq('organization_id', f.org).order('started_on').range(a, b));
  return computeTurnover(periods, f);
}

export async function punctuality(sb: SupabaseClient, f: ReportFilter): Promise<Report> {
  const flags = await all<FlagRow>((a, b) => {
    let q = sb.from('attendance_day_flags').select('employee_id, kind, minutes_late, store_id, work_date, employees(first_name, last_name, employee_code), stores(code)')
      .eq('organization_id', f.org).gte('work_date', f.from).lte('work_date', f.to).order('work_date');
    if (f.store) q = q.eq('store_id', f.store);
    return q.range(a, b) as unknown as Res<FlagRow>;
  });
  return computePunctuality(flags);
}

export async function discipline(sb: SupabaseClient, f: ReportFilter): Promise<Report> {
  const recs = await all<RecordRow>((a, b) => {
    let q = sb.from('disciplinary_records').select('incident_date, kind, measure, status, employee_informed, employees(first_name, last_name, employee_code), hr_catalog(label), stores(code)')
      .eq('organization_id', f.org).gte('incident_date', f.from).lte('incident_date', f.to).order('incident_date');
    if (f.store) q = q.eq('store_id', f.store);
    return q.range(a, b) as unknown as Res<RecordRow>;
  });
  return computeDiscipline(recs);
}

export const REPORTS: Record<ReportType, (sb: SupabaseClient, f: ReportFilter) => Promise<Report>> = { turnover, punctuality, discipline };
