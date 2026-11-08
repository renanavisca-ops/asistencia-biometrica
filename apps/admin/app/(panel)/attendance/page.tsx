import { getContext } from '@/lib/context';
import { OrgField, type SP } from '@/components/Flash';
import { defaultRange, orgPolicy, querySessions, workdaysFrom, type SessionRow } from '@/lib/attendance';
import { fmtDateTime, fmtDuration, STATE_LABEL } from '@/lib/format';

export default async function Attendance({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { supabase, org } = await getContext(sp.org);
  if (!org) return <p>Sin organización.</p>;
  const { from, to } = defaultRange(sp);
  const f = { org: org.id, from, to, store: sp.store || undefined, employee: sp.employee || undefined };
  const view = sp.view === 'sessions' ? 'sessions' : 'days';
  const [{ data: sessions, error }, { data: stores }, { data: emps }, pol] = await Promise.all([
    querySessions(supabase, f, view === 'days' ? 5000 : 500),
    supabase.from('stores').select('id, code, name').eq('organization_id', org.id).order('code'),
    supabase.from('employees').select('id, employee_code, first_name, last_name').eq('organization_id', org.id).order('last_name').limit(1000),
    orgPolicy(supabase, org.id),
  ]);
  const days = view === 'days' ? workdaysFrom((sessions ?? []) as unknown as SessionRow[], pol) : [];
  const qs = new URLSearchParams(Object.entries({ org: org.id, from, to, store: f.store ?? '', employee: f.employee ?? '' }).filter(([, v]) => v)).toString();
  return (
    <>
      <h2>Asistencia</h2>
      <p className="muted">“Permanencia” es el tiempo entre una entrada y su salida registradas; no equivale necesariamente a horas efectivamente trabajadas. No se calculan tardanzas ni horas extra (no hay horarios configurados).
        Las horas se muestran en la zona horaria de cada sede.</p>
      <form className="inline card" method="get">
        <OrgField org={org.id} />
        <label>Desde<input type="date" name="from" defaultValue={from} /></label>
        <label>Hasta<input type="date" name="to" defaultValue={to} /></label>
        <label>Sede<select name="store" defaultValue={f.store ?? ''}><option value="">Todas</option>{(stores ?? []).map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></label>
        <label>Empleado<select name="employee" defaultValue={f.employee ?? ''}><option value="">Todos</option>{(emps ?? []).map((e) => <option key={e.id} value={e.id}>{e.last_name}, {e.first_name}</option>)}</select></label>
        <button className="secondary">Filtrar</button>
        <input type="hidden" name="view" value={view} />
        <a href={`/api/export?type=days&${qs}`}>Exportar jornadas (CSV)</a>
        <a href={`/api/export?type=sessions&${qs}`}>Exportar sesiones (CSV)</a>
        <a href={`/api/export?type=events&${qs}`}>Exportar eventos (CSV)</a>
      </form>
      {error && <div className="msg error">{error.message}</div>}
      <p>
        {view === 'days' ? <b>Resumen por jornada</b> : <a href={`/attendance?${qs}&view=days`}>Resumen por jornada</a>}
        {' · '}
        {view === 'sessions' ? <b>Sesiones (entrada/salida)</b> : <a href={`/attendance?${qs}&view=sessions`}>Sesiones (entrada/salida)</a>}
      </p>
      {view === 'days' && (
        <>
          <p className="muted">Las pausas se deducen: una salida seguida de una entrada entre {pol.pauseMinMinutes} y {pol.pauseMaxMinutes} min es «pausa/almuerzo»;
            menos de {pol.pauseMinMinutes} min es «breve»; más de {pol.pauseMaxMinutes} min inicia otra jornada. Configurable en Política offline.</p>
          <table><thead><tr><th>Fecha</th><th>Empleado</th><th>Sede</th><th>Primera entrada</th><th>Última salida</th><th>Presente</th><th>Pausas</th><th>Estado</th></tr></thead><tbody>
            {days.map((d) => (
              <tr key={d.employeeId + d.date + d.firstInMs}>
                <td>{d.date}</td>
                <td>{d.employee.last_name}, {d.employee.first_name} <span className="muted mono">#{d.employee.employee_code}</span></td>
                <td>{d.store.code}</td>
                <td>{fmtDateTime(d.firstInMs ? new Date(d.firstInMs).toISOString() : null, d.store.timezone)}</td>
                <td>{d.open ? <span className="badge warn">en curso</span> : fmtDateTime(d.lastOutMs ? new Date(d.lastOutMs).toISOString() : null, d.store.timezone)}</td>
                <td>{fmtDuration(d.presentMinutes * 60)}</td>
                <td>{d.pauses.length === 0 ? <span className="muted">—</span> : d.pauses.map((p, i) => (
                  <div key={i}>{p.kind === 'pausa' ? 'Pausa/almuerzo' : 'Breve'}: {fmtDuration(p.minutes * 60)}</div>
                ))}</td>
                <td>{d.needsReview ? <span className="badge warn">revisar</span> : <span className="badge ok">ok</span>}</td>
              </tr>
            ))}
          </tbody></table>
        </>
      )}
      {view === 'sessions' && <table><thead><tr><th>Empleado</th><th>Sede</th><th>Entrada</th><th>Salida</th><th>Permanencia</th><th>Estado</th></tr></thead><tbody>
        {(sessions ?? []).map((s) => {
          const e = s.employees as unknown as { employee_code: string; first_name: string; last_name: string };
          const st = s.stores as unknown as { code: string; name: string; timezone: string };
          return (
            <tr key={s.id}>
              <td>{e.last_name}, {e.first_name} <span className="muted mono">#{e.employee_code}</span></td>
              <td>{st.code}</td>
              <td>{fmtDateTime(s.opened_at, st.timezone)}</td><td>{fmtDateTime(s.closed_at, st.timezone)}</td>
              <td>{fmtDuration(s.duration_seconds)}</td>
              <td>{STATE_LABEL[s.state]} {s.needs_review && <span className="badge warn">revisar</span>} {s.cross_store && <span className="badge">cambio de sede</span>}</td>
            </tr>
          );
        })}
      </tbody></table>}
      {view === 'sessions' && (sessions?.length ?? 0) >= 500 && <p className="muted">Mostrando 500 filas. Use la exportación para el total.</p>}
    </>
  );
}
