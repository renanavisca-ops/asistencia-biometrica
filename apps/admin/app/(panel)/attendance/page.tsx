import Link from 'next/link';
import { getContext } from '@/lib/context';
import { OrgField, type SP } from '@/components/Flash';
import { defaultRange, orgPolicy, querySessions, workdaysFrom, type SessionRow, type WorkdayRow } from '@/lib/attendance';
import { fmtDateTime, fmtDuration, STATE_LABEL } from '@/lib/format';
import { PresenceNow } from '@/components/PresenceNow';

const hm = (ms: number | null, tz: string) => (ms == null ? '—' : new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(ms)));
const dur = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`);
const dayLabel = (d: string) => new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(d + 'T12:00:00Z'));

function Estado({ d }: { d: WorkdayRow }) {
  return (
    <>
      {d.open ? <span className="badge ok">En turno</span> : d.onBreak ? <span className="badge warn">En almuerzo</span> : <span className="badge">Terminó</span>}
      {d.needsReview && <> <span className="badge warn" title="Hay marcaciones anómalas (salida olvidada, reloj dudoso, sede no asignada…). Ver Incidencias.">revisar</span></>}
    </>
  );
}

export default async function Attendance({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { supabase, org } = await getContext(sp.org);
  if (!org) return <p>Sin organización.</p>;
  const { from, to } = defaultRange(sp);
  const f = { org: org.id, from, to, store: sp.store || undefined, employee: sp.employee || undefined };
  const view = sp.view === 'sessions' ? 'sessions' : 'days';
  const [{ data: sessions, error }, { data: stores }, { data: emps }, pol] = await Promise.all([
    querySessions(supabase, f, view === 'days' ? 5000 : 500),
    supabase.from('stores').select('id, code, name, is_central').eq('organization_id', org.id).eq('status', 'active').order('code'),
    supabase.from('employees').select('id, employee_code, first_name, last_name').eq('organization_id', org.id).order('last_name').limit(1000),
    orgPolicy(supabase, org.id),
  ]);
  const days = view === 'days' ? workdaysFrom((sessions ?? []) as unknown as SessionRow[], pol) : [];
  const base = { org: org.id, from, to, employee: f.employee ?? '' };
  const url = (extra: Record<string, string | undefined>) =>
    '/attendance?' + new URLSearchParams(Object.entries({ ...base, store: f.store, view, ...extra }).filter(([, v]) => v) as [string, string][]).toString();
  const qs = new URLSearchParams(Object.entries({ ...base, store: f.store ?? '' }).filter(([, v]) => v)).toString();
  const current = (stores ?? []).find((s) => s.id === f.store);
  const now = Date.now();
  return (
    <>
      <h2>Asistencia{current ? ` · ${current.name}` : ''}</h2>

      <nav className="tabs" aria-label="Sucursales" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '6px 0 14px' }}>
        <Link href={url({ store: undefined })} className={!f.store ? 'tab active' : 'tab'} aria-current={!f.store ? 'page' : undefined}>Todas</Link>
        {(stores ?? []).map((s) => (
          <Link key={s.id} href={url({ store: s.id })} className={f.store === s.id ? 'tab active' : 'tab'} aria-current={f.store === s.id ? 'page' : undefined}>
            {s.code} · {s.name}{s.is_central ? ' (central)' : ''}
          </Link>
        ))}
      </nav>

      <PresenceNow sb={supabase} org={org.id} store={f.store} />

      <h3 style={{ marginTop: 24 }}>Jornadas</h3>
      <form className="inline card" method="get">
        <OrgField org={org.id} />
        {f.store && <input type="hidden" name="store" value={f.store} />}
        <input type="hidden" name="view" value={view} />
        <label>Desde<input type="date" name="from" defaultValue={from} /></label>
        <label>Hasta<input type="date" name="to" defaultValue={to} /></label>
        <label>Empleado<select name="employee" defaultValue={f.employee ?? ''}><option value="">Todos</option>{(emps ?? []).map((e) => <option key={e.id} value={e.id}>{e.last_name}, {e.first_name}</option>)}</select></label>
        <button className="secondary">Filtrar</button>
        <a href={`/api/export?type=days&${qs}`}>Descargar jornadas (CSV)</a>
        <a href={`/api/export?type=events&${qs}`}>Descargar marcaciones (CSV)</a>
      </form>
      {error && <div className="msg error">{error.message}</div>}

      {view === 'days' && (
        <>
          <table><thead><tr><th>Día</th><th>Empleado</th>{!f.store && <th>Sucursal</th>}<th>Entrada</th><th>Almuerzo / pausas</th><th>Salida</th><th>Total laborado</th><th>Estado</th></tr></thead><tbody>
            {days.map((d) => {
              const tz = d.store.timezone;
              const running = d.open && d.openSinceMs ? Math.round((now - d.openSinceMs) / 60_000) : 0;
              return (
                <tr key={d.employeeId + d.date + d.firstInMs}>
                  <td>{dayLabel(d.date)}</td>
                  <td>{d.employee.last_name}, {d.employee.first_name} <span className="muted mono">#{d.employee.employee_code}</span></td>
                  {!f.store && <td>{d.store.code}</td>}
                  <td>{hm(d.firstInMs, tz)}</td>
                  <td>{d.pauses.length === 0 && !d.onBreak ? <span className="muted">—</span> : <>
                    {d.pauses.map((p, i) => (
                      <div key={i}>{p.kind === 'almuerzo' ? 'Almuerzo' : p.kind === 'pausa' ? 'Pausa' : 'Breve'} {hm(p.fromMs, tz)}–{hm(p.toMs, tz)} ({dur(p.minutes)})</div>
                    ))}
                    {d.onBreak && d.lastOutMs && <div>Almuerzo desde {hm(d.lastOutMs, tz)} <span className="muted">(aún no regresa)</span></div>}
                  </>}</td>
                  <td>{d.open || d.onBreak ? <span className="muted">—</span> : hm(d.lastOutMs, tz)}</td>
                  <td><b>{dur(d.presentMinutes + running)}</b>{d.open && <span className="muted"> (en curso)</span>}</td>
                  <td><Estado d={d} /></td>
                </tr>
              );
            })}
            {days.length === 0 && <tr><td colSpan={8} className="muted">Sin marcaciones en este periodo.</td></tr>}
          </tbody></table>
          <p className="muted">«Total laborado» es el tiempo entre entradas y salidas sin contar el almuerzo; no son horas efectivamente trabajadas ni incluye tardanzas u horas extra (no hay horarios configurados).
            Horas en la zona horaria de cada sucursal. Las salidas registradas antes de la app 0.5 no indican si eran almuerzo: se deducen por el tiempo ({pol.pauseMinMinutes}–{pol.pauseMaxMinutes} min = pausa).</p>
          <p><Link href={url({ view: 'sessions' })}>Ver cada marcación de entrada y salida →</Link></p>
        </>
      )}

      {view === 'sessions' && (
        <>
          <p><Link href={url({ view: undefined })}>← Volver a jornadas</Link></p>
          <table><thead><tr><th>Empleado</th>{!f.store && <th>Sucursal</th>}<th>Entrada</th><th>Salida</th><th>Tipo de salida</th><th>Duración</th><th>Estado</th></tr></thead><tbody>
            {(sessions ?? []).map((s) => {
              const e = s.employees as unknown as { employee_code: string; first_name: string; last_name: string };
              const st = s.stores as unknown as { code: string; name: string; timezone: string };
              return (
                <tr key={s.id}>
                  <td>{e.last_name}, {e.first_name} <span className="muted mono">#{e.employee_code}</span></td>
                  {!f.store && <td>{st.code}</td>}
                  <td>{fmtDateTime(s.opened_at, st.timezone)}</td><td>{fmtDateTime(s.closed_at, st.timezone)}</td>
                  <td>{s.out_kind === 'break' ? 'Almuerzo' : s.out_kind === 'end' ? 'Fin de turno' : s.closed_at ? <span className="muted">sin indicar</span> : '—'}</td>
                  <td>{fmtDuration(s.duration_seconds)}</td>
                  <td>{STATE_LABEL[s.state]} {s.needs_review && <span className="badge warn">revisar</span>} {s.cross_store && <span className="badge">cambio de sede</span>}</td>
                </tr>
              );
            })}
          </tbody></table>
          {(sessions?.length ?? 0) >= 500 && <p className="muted">Mostrando 500 filas. Use la descarga CSV para el total.</p>}
        </>
      )}
    </>
  );
}
