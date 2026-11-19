import Link from 'next/link';
import type { Ctx } from '@/lib/context';
import { DAY_NAMES, mondayOf } from '@/lib/weekly';
import { WeeklyImport } from './WeeklyImport';

type Cell = { employee_id: string; employee_code: string; first_name: string; last_name: string; weekday: number; work_date: string;
  start_time: string | null; end_time: string | null; kind: string; schedule_name: string | null };
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const hm = (t: string | null) => (t ? t.slice(0, 5) : '');

/** Semana de una sucursal: quién entra a qué hora cada día, con descarga de plantilla y carga del Excel. */
export async function StoreWeek({ ctx, store, week }: { ctx: Ctx; store: { id: string; code: string; name: string }; week?: string }) {
  const { supabase, org, orgWide } = ctx;
  const monday = mondayOf(week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : new Date().toISOString().slice(0, 10));
  const { data, error } = await supabase.rpc('store_week_schedule', { p_store: store.id, p_week_start: monday });
  const cells = (data ?? []) as Cell[];
  const emps = [...new Map(cells.map((c) => [c.employee_id, c])).values()];
  const base = `/schedules?org=${org!.id}&store=${store.id}`;
  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <Link className="tab" href={`${base}&week=${addDays(monday, -7)}`}>← Semana anterior</Link>
        <b>Semana del {new Date(monday + 'T12:00:00').toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })}</b>
        <Link className="tab" href={`${base}&week=${addDays(monday, 7)}`}>Semana siguiente →</Link>
        <form method="get" className="inline" style={{ marginLeft: 'auto' }}>
          <input type="hidden" name="org" value={org!.id} /><input type="hidden" name="store" value={store.id} />
          <input type="date" name="week" defaultValue={monday} /><button className="secondary">Ir</button>
        </form>
      </div>
      {error && <div className="msg error">{error.message}</div>}
      <table><thead><tr><th>Empleado</th>{DAY_NAMES.map((d, i) => <th key={d}>{d}<div className="muted" style={{ textTransform: 'none' }}>{addDays(monday, i).slice(5)}</div></th>)}</tr></thead><tbody>
        {emps.map((e) => (
          <tr key={e.employee_id}><td>{e.last_name}, {e.first_name} <span className="muted mono">#{e.employee_code}</span></td>
            {[1, 2, 3, 4, 5, 6, 7].map((d) => {
              const c = cells.find((x) => x.employee_id === e.employee_id && x.weekday === d);
              return <td key={d} title={c?.schedule_name ?? ''}>{c?.kind === 'scheduled' ? <>{hm(c.start_time)}{c.end_time ? `–${hm(c.end_time)}` : ''}</>
                : c?.kind === 'exception' ? <span className="badge">permiso/libre</span> : <span className="muted">—</span>}</td>;
            })}</tr>
        ))}
        {!emps.length && <tr><td colSpan={8} className="muted">No hay empleados asignados a esta tienda en esa semana.</td></tr>}
      </tbody></table>
      <p className="muted">«—» = sin horario ese día (no se controla puntualidad). Pase el cursor sobre una hora para ver de qué horario proviene.</p>
      {orgWide('schedule.manage') && (
        <div className="card" style={{ marginTop: 12 }}>
          <h3>Cargar el horario de la semana desde Excel</h3>
          <ol className="muted" style={{ marginTop: 0 }}>
            <li>Descargue la plantilla: ya trae a los empleados de la tienda y el horario actual de esa semana.</li>
            <li>Escriba la hora de entrada y salida de cada día (08:00, 8:00 pm…). Día libre: déjelo vacío o escriba «descanso».</li>
            <li>Súbala aquí. Reemplaza lo cargado antes para esa misma semana y recalcula las tardanzas si la semana ya empezó.</li>
          </ol>
          <p><a href={`/api/schedule-template?store=${store.id}&week=${monday}`}><button type="button" className="secondary">Descargar plantilla de la semana ({store.code})</button></a></p>
          <WeeklyImport store={store.id} storeCode={store.code} />
          <p className="muted">El horario cargado aplica solo a esa semana y tiene prioridad sobre el horario general de la sucursal. Los permisos y días libres
            registrados como excepción siguen aplicando.</p>
        </div>
      )}
    </>
  );
}
