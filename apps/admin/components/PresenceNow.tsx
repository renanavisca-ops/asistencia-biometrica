import type { Ctx } from '@/lib/context';
import { fmtDuration } from '@/lib/format';

type Emp = { id: string; employee_code: string; first_name: string; last_name: string };
type Sess = { employee_id: string; state: string; opened_at: string | null; closed_at: string | null; duration_seconds: number | null; needs_review: boolean; out_kind: 'break' | 'end' | null;
  stores: { code: string; timezone: string } | null };

const hm = (iso: string, tz?: string) => new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso));
const dayDiff = (iso: string) => (Date.now() - Date.parse(iso)) / 86400e3;

/**
 * Estado actual del personal: quién está dentro (y desde cuándo), quién ya salió y cuánto duró su turno.
 * Se basa en marcaciones YA SINCRONIZADAS: un teléfono sin conexión puede tener marcaciones pendientes.
 */
export async function PresenceNow({ sb, org, store }: { sb: Ctx['supabase']; org: string; store?: string }) {
  const since = new Date(Date.now() - 36 * 3600e3).toISOString();
  let sq = sb.from('attendance_sessions')
    .select('employee_id, state, opened_at, closed_at, duration_seconds, needs_review, out_kind, stores(code, timezone)')
    .eq('organization_id', org)
    .or(`opened_at.gte.${since},closed_at.gte.${since}`)
    .order('opened_at', { ascending: false, nullsFirst: false }).limit(2000);
  if (store) sq = sq.eq('store_id', store);
  const nowIso = new Date().toISOString();
  const [{ data: emps, error: e1 }, { data: sess, error: e2 }, { data: asg }] = await Promise.all([
    sb.from('employees').select('id, employee_code, first_name, last_name').eq('organization_id', org).eq('status', 'active').order('last_name').limit(1000),
    sq,
    store ? sb.from('employee_store_assignments').select('employee_id').eq('store_id', store).is('revoked_at', null).lte('valid_from', nowIso)
      .or(`valid_to.is.null,valid_to.gt.${nowIso}`) : Promise.resolve({ data: null }),
  ]);
  const assigned = new Set(((asg ?? []) as { employee_id: string }[]).map((a) => a.employee_id));
  if (e1 || e2) return <div className="msg error">{(e1 ?? e2)!.message}</div>;
  // Última sesión de cada empleado (por hora de entrada, o de salida si no hubo entrada).
  const last = new Map<string, Sess>();
  for (const s of (sess ?? []) as unknown as Sess[]) {
    const t = (x: Sess) => Date.parse(x.opened_at ?? x.closed_at ?? '1970-01-01');
    const cur = last.get(s.employee_id);
    if (!cur || t(s) > t(cur)) last.set(s.employee_id, s);
  }
  const rows = ((emps ?? []) as Emp[]).map((e) => ({ e, s: last.get(e.id) ?? null }))
    .filter(({ e, s }) => !store || s || assigned.has(e.id));
  const inside = rows.filter((r) => r.s?.state === 'open').length;
  const lunch = rows.filter((r) => r.s?.state === 'closed' && r.s.out_kind === 'break').length;
  const rank = (s: Sess | null) => (s?.state === 'open' ? 0 : s?.out_kind === 'break' && s.state === 'closed' ? 1 : s ? 2 : 3);
  rows.sort((a, b) => rank(a.s) - rank(b.s) || a.e.last_name.localeCompare(b.e.last_name));
  return (
    <>
      <h3>Personal ahora <span className="badge ok">{inside} en turno</span> {lunch > 0 && <span className="badge warn">{lunch} en almuerzo</span>}</h3>
      <table><thead><tr><th>Empleado</th><th>Estado</th><th>Sede</th><th>Entrada</th><th>Salida</th><th>Tiempo</th></tr></thead><tbody>
        {rows.map(({ e, s }) => {
          const tz = s?.stores?.timezone;
          let estado = <span className="muted">Sin marcación en las últimas 36 h</span>;
          let turno = '—';
          if (s?.state === 'open' && s.opened_at) {
            const long = dayDiff(s.opened_at) > 0.6;
            estado = <span className={`badge ${long ? 'warn' : 'ok'}`}>{long ? 'Dentro (¿olvidó la salida?)' : 'Dentro'}</span>;
            turno = `${fmtDuration((Date.now() - Date.parse(s.opened_at)) / 1000)} (en curso)`;
          } else if (s?.state === 'closed' && s.out_kind === 'break' && s.closed_at) {
            estado = <span className="badge warn">En almuerzo</span>;
            turno = `almuerzo desde hace ${fmtDuration((Date.now() - Date.parse(s.closed_at)) / 1000)}`;
          } else if (s?.state === 'closed') {
            estado = <span className="badge">Salió</span>;
            turno = `${fmtDuration(s.duration_seconds)} (último tramo)`;
          } else if (s?.state === 'missing_out') {
            estado = <span className="badge warn">Salida omitida</span>;
          } else if (s?.state === 'orphan_out') {
            estado = <span className="badge warn">Salida sin entrada</span>;
          }
          return (
            <tr key={e.id}>
              <td>{e.last_name}, {e.first_name} <span className="muted mono">#{e.employee_code}</span></td>
              <td>{estado} {s?.needs_review && <span className="badge warn">revisar</span>}</td>
              <td>{s?.stores?.code ?? '—'}</td>
              <td>{s?.opened_at ? `${dayDiff(s.opened_at) > 0.5 ? 'ayer ' : ''}${hm(s.opened_at, tz)}` : '—'}</td>
              <td>{s?.closed_at ? hm(s.closed_at, tz) : '—'}</td>
              <td>{turno}</td>
            </tr>
          );
        })}
      </tbody></table>
      <p className="muted">Según marcaciones ya sincronizadas; un teléfono sin internet puede tener marcaciones pendientes. El total del día (sin almuerzo) está en «Jornadas».</p>
    </>
  );
}
