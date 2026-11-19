import Link from 'next/link';
import { getContext } from '@/lib/context';
import { Flash, OrgField, type SP } from '@/components/Flash';
import { fmtDateTime } from '@/lib/format';
import { ALERT_EVENT, ALERT_STATUS, fmtDate, fmtTime, monthEnd, monthStart } from '@/lib/hr';
import { followup, saveRules } from './actions';

type Emp = { first_name: string; last_name: string; employee_code: string };

export default async function Alerts({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const ctx = await getContext(sp.org);
  const { supabase, org, can, orgWide, feature } = ctx;
  if (!org) return <p>Sin organización.</p>;
  if (!feature('alerts')) return <p>Este módulo no está habilitado en el plan de su organización.</p>;
  if (!can('alert.read')) return <p>Sin permiso para ver alertas.</p>;
  const status = sp.status ?? 'open';
  let q = supabase.from('alerts').select('*, employees(first_name, last_name, employee_code), stores(code, name)').eq('organization_id', org.id)
    .order('period_key', { ascending: false }).order('count', { ascending: false }).limit(300);
  if (status === 'open') q = q.eq('status', 'pending'); else if (status !== 'all') q = q.eq('status', status);
  if (sp.month) q = q.eq('period_key', sp.month);
  if (sp.store) q = q.eq('store_id', sp.store);
  const [{ data: alerts }, { data: rules }, { data: stores }] = await Promise.all([
    q, supabase.from('alert_rules').select('*').eq('organization_id', org.id).maybeSingle(),
    supabase.from('stores').select('id, code, name').eq('organization_id', org.id).order('code'),
  ]);
  const sel = sp.id ? (await supabase.from('alerts').select('*, employees(id, first_name, last_name, employee_code), stores(code, name, timezone)').eq('id', sp.id).maybeSingle()).data : null;
  const [{ data: evs }, { data: flags }, { data: admins }] = sel ? await Promise.all([
    supabase.from('alert_events').select('*').eq('alert_id', sel.id).order('created_at'),
    supabase.from('attendance_day_flags').select('*').eq('employee_id', sel.employee_id).eq('kind', 'late')
      .gte('work_date', monthStart(sel.period_key)).lte('work_date', monthEnd(sel.period_key)).order('work_date'),
    supabase.from('admins').select('user_id, display_name'),
  ]) : [{ data: null }, { data: null }, { data: null }];
  const who = (id: string | null) => (admins ?? []).find((a) => a.user_id === id)?.display_name ?? 'sistema';
  const base = `/alerts?org=${org.id}`;
  const manage = can('alert.manage');
  return (
    <>
      <h2>Alertas de puntualidad</h2>
      <Flash sp={sp} />
      <p className="muted">Se genera una sola alerta por empleado y mes cuando alcanza {rules?.tardiness_threshold ?? 3} llegadas tarde en el mes calendario; las siguientes la actualizan.
        Las alertas no aplican sanciones: sirven para revisar el caso y, si corresponde, registrar una medida en el expediente.</p>
      <form className="inline" method="get" style={{ marginBottom: 12 }}>
        <input type="hidden" name="org" value={org.id} />
        <label>Estado<select name="status" defaultValue={status}><option value="open">Pendientes</option><option value="reviewed">Revisadas</option>
          <option value="dismissed">Descartadas</option><option value="closed">Cerradas</option><option value="all">Todas</option></select></label>
        <label>Mes<input type="month" name="month" defaultValue={sp.month ?? ''} /></label>
        <label>Sucursal<select name="store" defaultValue={sp.store ?? ''}><option value="">Todas</option>{(stores ?? []).map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></label>
        <button className="secondary">Filtrar</button>
      </form>

      {sel && (
        <div className="card" style={{ borderColor: '#f59e0b' }}>
          <h3>Alerta {sel.period_key}: {(sel.employees as Emp).last_name}, {(sel.employees as Emp).first_name} <span className={`badge ${ALERT_STATUS[sel.status]?.[1]}`}>{ALERT_STATUS[sel.status]?.[0]}</span></h3>
          <p>{sel.details?.message}</p>
          <p className="muted">Sucursal: {(sel.stores as { code: string; name: string } | null)?.name ?? '—'} · umbral {sel.threshold} · creada {fmtDateTime(sel.created_at)}</p>
          <table><thead><tr><th>Fecha</th><th>Entrada programada</th><th>Primera entrada</th><th>Minutos tarde</th></tr></thead><tbody>
            {(flags ?? []).map((f) => {
              const tz = (sel.stores as { timezone: string } | null)?.timezone;
              return <tr key={f.work_date}><td>{fmtDate(f.work_date)}</td><td>{fmtTime(f.scheduled_start, tz)} (+{f.tolerance_minutes} min)</td><td>{fmtTime(f.first_in_at, tz)}</td><td>{f.minutes_late}</td></tr>;
            })}
          </tbody></table>
          <h4>Historial</h4>
          <ul className="muted">{(evs ?? []).map((v) => (
            <li key={v.id}>{fmtDateTime(v.created_at)} · {who(v.actor)} — {ALERT_EVENT[v.kind]}
              {v.kind === 'count_changed' ? `: ${v.from_value} → ${v.to_value}` : v.kind === 'status' ? `: ${ALERT_STATUS[v.from_value]?.[0]} → ${ALERT_STATUS[v.to_value]?.[0]}` : v.kind === 'created' ? ` (${v.to_value})` : ''}
              {v.comment ? `. ${v.comment}` : ''}</li>
          ))}</ul>
          {manage && (
            <form action={followup} className="inline"><OrgField org={org.id} /><input type="hidden" name="alert_id" value={sel.id} />
              <label>Acción<select name="status" defaultValue=""><option value="">Solo comentar</option><option value="reviewed">Marcar como revisada</option>
                <option value="dismissed">Descartar (requiere justificación)</option><option value="closed">Cerrar</option><option value="pending">Reabrir</option></select></label>
              <label>Comentario / justificación<input name="comment" style={{ minWidth: 300 }} /></label><button>Registrar</button>
            </form>
          )}
          <p style={{ marginTop: 10 }}><Link href={`/employees/${(sel.employees as { id: string }).id}?org=${org.id}`}>Abrir expediente</Link> (para registrar una medida disciplinaria si corresponde) · <Link href={base}>Cerrar detalle</Link></p>
        </div>
      )}

      <table><thead><tr><th>Mes</th><th>Empleado</th><th>Sucursal</th><th>Tardanzas</th><th>Estado</th><th>Actualizada</th></tr></thead><tbody>
        {(alerts ?? []).map((a) => {
          const em = a.employees as Emp;
          return (
            <tr key={a.id}><td>{a.period_key}</td><td><Link href={`${base}&id=${a.id}&status=${status}`}>{em.last_name}, {em.first_name}</Link> <span className="muted mono">#{em.employee_code}</span></td>
              <td>{(a.stores as { code: string } | null)?.code ?? '—'}</td><td><b>{a.count}</b> / {a.threshold}</td>
              <td><span className={`badge ${ALERT_STATUS[a.status]?.[1]}`}>{ALERT_STATUS[a.status]?.[0]}</span></td><td>{fmtDateTime(a.updated_at)}</td></tr>
          );
        })}
        {!alerts?.length && <tr><td colSpan={6} className="muted">No hay alertas con estos filtros.</td></tr>}
      </tbody></table>

      {orgWide('alert.manage') && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Regla de tardanzas</h3>
          <form action={saveRules} className="inline"><OrgField org={org.id} />
            <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="checkbox" name="enabled" defaultChecked={rules?.tardiness_enabled ?? true} style={{ minWidth: 0 }} /> Activa</label>
            <label>Tardanzas en el mes calendario para alertar<input type="number" name="threshold" min={1} max={31} defaultValue={rules?.tardiness_threshold ?? 3} /></label>
            <button className="secondary">Guardar</button>
          </form>
        </div>
      )}
    </>
  );
}
