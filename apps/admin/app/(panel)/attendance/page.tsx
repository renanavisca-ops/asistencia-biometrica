import { getContext } from '@/lib/context';
import { OrgField, type SP } from '@/components/Flash';
import { defaultRange, querySessions } from '@/lib/attendance';
import { fmtDateTime, fmtDuration, STATE_LABEL } from '@/lib/format';

export default async function Attendance({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { supabase, org } = await getContext(sp.org);
  if (!org) return <p>Sin organización.</p>;
  const { from, to } = defaultRange(sp);
  const f = { org: org.id, from, to, store: sp.store || undefined, employee: sp.employee || undefined };
  const [{ data: sessions, error }, { data: stores }, { data: emps }] = await Promise.all([
    querySessions(supabase, f, 500),
    supabase.from('stores').select('id, code, name').eq('organization_id', org.id).order('code'),
    supabase.from('employees').select('id, employee_code, first_name, last_name').eq('organization_id', org.id).order('last_name').limit(1000),
  ]);
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
        <a href={`/api/export?type=sessions&${qs}`}>Exportar sesiones (CSV)</a>
        <a href={`/api/export?type=events&${qs}`}>Exportar eventos (CSV)</a>
      </form>
      {error && <div className="msg error">{error.message}</div>}
      <table><thead><tr><th>Empleado</th><th>Sede</th><th>Entrada</th><th>Salida</th><th>Permanencia</th><th>Estado</th></tr></thead><tbody>
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
      </tbody></table>
      {(sessions?.length ?? 0) >= 500 && <p className="muted">Mostrando 500 filas. Use la exportación para el total.</p>}
    </>
  );
}
