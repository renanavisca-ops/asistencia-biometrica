import Link from 'next/link';
import type { SupabaseClient } from '@supabase/supabase-js';
import { monthEnd } from '@/lib/hr';

/** Indicadores de personal del mes (filtrables por mes y sucursal). Datos reales de la base; RLS limita lo visible. */
export async function HrKpis({ sb, org, month, store, stores, can }: {
  sb: SupabaseClient; org: string; month: string; store?: string; stores: { id: string; code: string; name: string }[]; can: (p: string) => boolean;
}) {
  const first = `${month}-01`, last = monthEnd(month);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const st = (q: any) => (store ? q.eq('store_id', store) : q) as PromiseLike<{ count: number | null }>;
  const [late, noShow, alerts, disc, hires, exits, ini, fin] = await Promise.all([
    st(sb.from('attendance_day_flags').select('employee_id', { count: 'exact', head: true }).eq('organization_id', org).eq('kind', 'late').gte('work_date', first).lte('work_date', last)),
    st(sb.from('attendance_day_flags').select('employee_id', { count: 'exact', head: true }).eq('organization_id', org).eq('kind', 'no_show').gte('work_date', first).lte('work_date', last)),
    can('alert.read') ? st(sb.from('alerts').select('id', { count: 'exact', head: true }).eq('organization_id', org).eq('status', 'pending')) : Promise.resolve({ count: null }),
    can('hr.read') ? st(sb.from('disciplinary_records').select('id', { count: 'exact', head: true }).eq('organization_id', org).in('status', ['pending', 'in_review'])) : Promise.resolve({ count: null }),
    can('hr.read') ? sb.from('employment_periods').select('id', { count: 'exact', head: true }).eq('organization_id', org).gte('started_on', first).lte('started_on', last) : Promise.resolve({ count: null }),
    can('hr.read') ? sb.from('employment_periods').select('id', { count: 'exact', head: true }).eq('organization_id', org).gte('ended_on', first).lte('ended_on', last) : Promise.resolve({ count: null }),
    can('hr.read') ? sb.from('employment_periods').select('id', { count: 'exact', head: true }).eq('organization_id', org).lte('started_on', first).or(`ended_on.is.null,ended_on.gte.${first}`) : Promise.resolve({ count: null }),
    can('hr.read') ? sb.from('employment_periods').select('id', { count: 'exact', head: true }).eq('organization_id', org).lte('started_on', last).or(`ended_on.is.null,ended_on.gte.${last}`) : Promise.resolve({ count: null }),
  ]);
  const avg = ((ini.count ?? 0) + (fin.count ?? 0)) / 2;
  const rot = exits.count != null && avg ? `${Math.round((exits.count / avg) * 1000) / 10}%` : '—';
  const q = `?org=${org}`;
  return (
    <>
      <h3>Personal y puntualidad</h3>
      <form className="inline" method="get" style={{ marginBottom: 10 }}>
        <input type="hidden" name="org" value={org} />
        <label>Mes<input type="month" name="month" defaultValue={month} /></label>
        <label>Sucursal (puntualidad, alertas, disciplina)<select name="store" defaultValue={store ?? ''}><option value="">Todas</option>
          {stores.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></label>
        <button className="secondary">Aplicar</button>
      </form>
      <div className="grid">
        <div className="card kpi"><b>{late.count ?? 0}</b><span>Llegadas tarde en el mes</span></div>
        <div className="card kpi"><b>{noShow.count ?? 0}</b><span>Días con horario sin marcación</span></div>
        {alerts.count != null && <div className="card kpi"><Link href={`/alerts${q}`}><b>{alerts.count}</b></Link><span>Alertas pendientes</span></div>}
        {disc.count != null && <div className="card kpi"><Link href={`/discipline${q}&status=open`}><b>{disc.count}</b></Link><span>Casos disciplinarios abiertos</span></div>}
        {hires.count != null && <div className="card kpi"><b>{hires.count}</b><span>Altas del mes (incl. recontrataciones)</span></div>}
        {exits.count != null && <div className="card kpi"><b>{exits.count}</b><span>Bajas del mes</span></div>}
        {exits.count != null && <div className="card kpi"><b>{rot}</b><span>Rotación del mes (toda la organización)</span></div>}
      </div>
      <p className="muted">Las tardanzas solo se calculan para quienes tienen horario de referencia. Rotación = bajas / plantilla promedio × 100 (ver Reportes).</p>
    </>
  );
}
