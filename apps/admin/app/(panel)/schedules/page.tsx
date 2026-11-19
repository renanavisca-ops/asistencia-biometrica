import { getContext } from '@/lib/context';
import { Flash, OrgField, type SP } from '@/components/Flash';
import { EXC_KIND, WEEKDAYS, fmtDate } from '@/lib/hr';
import Link from 'next/link';
import { addException, assign, deleteException, endAssignment, recompute, saveSchedule } from './actions';
import { StoreWeek } from './StoreWeek';

type Day = { weekday: number; start_time: string; end_time: string | null };
const hm = (t: string | null | undefined) => (t ? t.slice(0, 5) : '');
const today = () => new Date().toISOString().slice(0, 10);

function ScheduleForm({ org, sched }: { org: string; sched?: { id: string; name: string; tolerance_minutes: number; active: boolean; days: Day[] } }) {
  const day = (d: number) => sched?.days.find((x) => x.weekday === d);
  return (
    <form action={saveSchedule} style={{ display: 'grid', gap: 8 }}>
      <OrgField org={org} />{sched && <input type="hidden" name="schedule_id" value={sched.id} />}
      <div className="inline" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label>Nombre<input name="name" required minLength={2} defaultValue={sched?.name} placeholder="p. ej. Turno mañana" /></label>
        <label>Tolerancia (minutos)<input type="number" name="tolerance" min={0} max={240} defaultValue={sched?.tolerance_minutes ?? 5} /></label>
        {sched && <label>Estado<select name="active" defaultValue={sched.active ? 'on' : 'off'}><option value="on">Activo</option><option value="off">Inactivo</option></select></label>}
      </div>
      <table><thead><tr><th>Día</th><th>Entrada</th><th>Salida (opcional; menor que la entrada = turno nocturno)</th></tr></thead><tbody>
        {WEEKDAYS.map(([d, n]) => (
          <tr key={d}><td>{n}</td><td><input type="time" name={`start_${d}`} defaultValue={hm(day(d)?.start_time)} /></td>
            <td><input type="time" name={`end_${d}`} defaultValue={hm(day(d)?.end_time)} /></td></tr>
        ))}
      </tbody></table>
      <p className="muted" style={{ margin: 0 }}>Deje vacía la entrada de los días que no se controlan (descanso).</p>
      <button>{sched ? 'Guardar cambios' : 'Crear horario'}</button>
    </form>
  );
}

/** Horarios de referencia OPCIONALES: solo se calculan tardanzas para quien tenga uno asignado. */
export default async function Schedules({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const ctx = await getContext(sp.org);
  const { supabase, org, orgWide, feature } = ctx;
  if (!org) return <p>Sin organización.</p>;
  if (!feature('schedules')) return <p>Este módulo no está habilitado en el plan de su organización.</p>;
  const manage = orgWide('schedule.manage');
  const [{ data: scheds }, { data: days }, { data: asg }, { data: exc }, { data: stores }, { data: emps }] = await Promise.all([
    supabase.from('work_schedules').select('*').eq('organization_id', org.id).eq('source', 'manual').order('name'),
    supabase.from('work_schedule_days').select('schedule_id, weekday, start_time, end_time').eq('organization_id', org.id),
    supabase.from('schedule_assignments').select('*, work_schedules(name), stores(code, name), employees(first_name, last_name, employee_code)').eq('organization_id', org.id).or('note.is.null,note.not.like.semana:*').order('valid_from', { ascending: false }),
    supabase.from('schedule_exceptions').select('*, stores(code), employees(first_name, last_name)').eq('organization_id', org.id).gte('on_date', new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10)).order('on_date', { ascending: false }),
    supabase.from('stores').select('id, code, name').eq('organization_id', org.id).eq('status', 'active').order('code'),
    supabase.from('employees').select('id, first_name, last_name, employee_code').eq('organization_id', org.id).neq('status', 'terminated').order('last_name'),
  ]);
  const list: { id: string; name: string; tolerance_minutes: number; active: boolean; days: Day[] }[] = (scheds ?? []).map((x) => ({ ...x, days: ((days ?? []) as (Day & { schedule_id: string })[]).filter((d) => d.schedule_id === x.id).sort((a, b) => a.weekday - b.weekday) }));
  const targets = (
    <>
      <optgroup label="Sucursal (todo su personal)">{(stores ?? []).map((s) => <option key={s.id} value={`s:${s.id}`}>{s.code} · {s.name}</option>)}</optgroup>
      <optgroup label="Empleado (tiene prioridad sobre la sucursal)">{(emps ?? []).map((e) => <option key={e.id} value={`e:${e.id}`}>{e.last_name}, {e.first_name} #{e.employee_code}</option>)}</optgroup>
    </>
  );
  const nowD = today();
  const selStore = (stores ?? []).find((s) => s.id === sp.store);
  return (
    <>
      <h2>Horarios de referencia</h2>
      <Flash sp={sp} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        <Link className={`tab ${!sp.store ? 'active' : ''}`} href={`/schedules?org=${org.id}`}>General</Link>
        {(stores ?? []).map((s) => <Link key={s.id} className={`tab ${sp.store === s.id ? 'active' : ''}`} href={`/schedules?org=${org.id}&store=${s.id}`}>{s.code} · {s.name}</Link>)}
      </div>
      {selStore ? <StoreWeek ctx={ctx} store={selStore} week={sp.week} /> : <>
      <p className="muted">Los horarios son <b>opcionales</b>. Sin horario asignado no se calcula ninguna tardanza. Una llegada tarde es la <b>primera entrada válida</b> del día posterior a la
        hora programada más la tolerancia; cuenta una sola vez por jornada. Prioridad: excepción del empleado › excepción de la sucursal › horario del empleado › horario de la sucursal.
        Las correcciones de asistencia y las marcaciones offline que llegan después recalculan automáticamente.</p>

      <h3>Horarios</h3>
      {list.map((x) => (
        <details key={x.id} className="card" style={{ marginBottom: 8 }}>
          <summary><b>{x.name}</b> · tolerancia {x.tolerance_minutes} min {!x.active && <span className="badge">inactivo</span>} — <span className="muted">
            {x.days.map((d: Day) => `${WEEKDAYS.find(([n]) => n === d.weekday)?.[1].slice(0, 3)} ${hm(d.start_time)}${d.end_time ? '–' + hm(d.end_time) : ''}`).join(' · ') || 'sin días'}</span></summary>
          {manage && <div style={{ marginTop: 8 }}><ScheduleForm org={org.id} sched={x} /></div>}
        </details>
      ))}
      {!list.length && <p className="muted">Aún no hay horarios.</p>}
      {manage && <details className="card"><summary>Nuevo horario</summary><div style={{ marginTop: 8 }}><ScheduleForm org={org.id} /></div></details>}

      <h3>Asignaciones</h3>
      <table><thead><tr><th>Horario</th><th>Aplica a</th><th>Vigencia</th><th>Nota</th><th></th></tr></thead><tbody>
        {(asg ?? []).map((a) => {
          const em = a.employees as { first_name: string; last_name: string; employee_code: string } | null;
          const st = a.stores as { code: string; name: string } | null;
          const current = a.valid_from <= nowD && (!a.valid_to || a.valid_to >= nowD);
          return (
            <tr key={a.id}><td>{(a.work_schedules as { name: string }).name}</td>
              <td>{em ? `Empleado: ${em.last_name}, ${em.first_name}` : `Sucursal ${st?.code} · ${st?.name}`}</td>
              <td>{fmtDate(a.valid_from)} → {a.valid_to ? fmtDate(a.valid_to) : 'indefinido'} {current && <span className="badge ok">vigente</span>}</td><td>{a.note}</td>
              <td>{manage && (!a.valid_to || a.valid_to >= nowD) && (
                <form action={endAssignment} className="inline"><OrgField org={org.id} /><input type="hidden" name="assignment_id" value={a.id} />
                  <input type="date" name="valid_to" required min={a.valid_from} defaultValue={nowD} /><button className="secondary">Terminar</button></form>
              )}</td></tr>
          );
        })}
        {!asg?.length && <tr><td colSpan={5} className="muted">Sin asignaciones: no se calculan tardanzas.</td></tr>}
      </tbody></table>
      {manage && !!list.length && (
        <form action={assign} className="inline card" style={{ marginTop: 8 }}><OrgField org={org.id} />
          <label>Horario<select name="schedule_id" required>{list.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label>Aplica a<select name="target" required>{targets}</select></label>
          <label>Desde<input type="date" name="valid_from" required defaultValue={nowD} /></label>
          <label>Hasta (cambio temporal)<input type="date" name="valid_to" /></label>
          <label>Nota<input name="note" /></label>
          <button>Asignar</button>
        </form>
      )}

      <h3>Excepciones (últimos 60 días y futuras)</h3>
      <table><thead><tr><th>Fecha</th><th>Aplica a</th><th>Tipo</th><th>Motivo</th><th></th></tr></thead><tbody>
        {(exc ?? []).map((x) => {
          const em = x.employees as { first_name: string; last_name: string } | null;
          return (
            <tr key={x.id}><td>{fmtDate(x.on_date)}</td><td>{em ? `${em.last_name}, ${em.first_name}` : `Sucursal ${(x.stores as { code: string } | null)?.code}`}</td>
              <td>{EXC_KIND[x.kind]}{x.kind === 'custom' ? ` (entrada ${hm(x.start_time)})` : ''}</td><td>{x.reason}</td>
              <td>{manage && <form action={deleteException}><OrgField org={org.id} /><input type="hidden" name="exception_id" value={x.id} /><button className="secondary">Eliminar</button></form>}</td></tr>
          );
        })}
        {!exc?.length && <tr><td colSpan={5} className="muted">Sin excepciones.</td></tr>}
      </tbody></table>
      {manage && (
        <form action={addException} className="inline card" style={{ marginTop: 8 }}><OrgField org={org.id} />
          <label>Fecha<input type="date" name="on_date" required /></label>
          <label>Aplica a<select name="target" required>{targets}</select></label>
          <label>Tipo<select name="kind">{Object.entries(EXC_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Entrada (solo horario especial)<input type="time" name="start_time" /></label>
          <label>Motivo<input name="reason" required minLength={3} /></label>
          <button>Registrar</button>
        </form>
      )}

      {manage && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Recalcular tardanzas</h3>
          <p className="muted">Tras crear o cambiar horarios, recalcule desde la fecha en que deben aplicar (máximo ~13 meses atrás). Las alertas se actualizan sin duplicarse.</p>
          <form action={recompute} className="inline"><OrgField org={org.id} />
            <label>Desde<input type="date" name="from" required defaultValue={nowD.slice(0, 8) + '01'} /></label><button className="secondary">Recalcular</button></form>
        </div>
      )}
      </>}
    </>
  );
}
