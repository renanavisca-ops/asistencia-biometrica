import Link from 'next/link';
import { getContext } from '@/lib/context';
import { Flash, type SP } from '@/components/Flash';
import { ago } from '@/lib/format';
import { createOwnOrg, setPlan, setStatus } from './actions';

type Row = {
  id: string; name: string; country_code: string | null; status: string; access: string; created_at: string; created_via: string;
  employees_active: number; employees_enrolled: number; stores: number; devices_active: number; punches_30d: number; last_activity: string | null;
  unlimited: boolean; paid_max_employees: number | null; paid_until: string | null; needed_tier_label: string; plan_label: string; over_limit: boolean;
  admin_contacts: string | null; support_until: string | null; deletion_due_at: string | null; suspended_reason: string | null;
};
const TIERS: [string, string][] = [['5', 'Gratis (1–5)'], ['10', '6–10'], ['20', '11–20'], ['30', '21–30'], ['50', '31–50'], ['100', '51–100'],
  ['150', '101–150'], ['200', '151–200'], ['250', '201–250'], ['300', '251–300'], ['unlimited', 'Sin límite']];
const COUNTRIES: [string, string][] = [['GT', 'Guatemala'], ['SV', 'El Salvador'], ['HN', 'Honduras'], ['NI', 'Nicaragua'], ['CR', 'Costa Rica'], ['PA', 'Panamá'], ['BZ', 'Belice']];
const STATUS: Record<string, [string, string]> = { active: ['Activa', 'ok'], suspended: ['Suspendida', 'err'], pending_deletion: ['En eliminación', 'warn'] };
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es') : '—');

/** Plataforma: solo cifras de uso y planes. No muestra datos de las organizaciones (privacidad de los clientes). */
export default async function Platform({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { supabase, isSuper } = await getContext(sp.org);
  if (!isSuper) return <p>Solo para el superadministrador de la plataforma.</p>;
  const { data, error } = await supabase.rpc('platform_orgs');
  const rows = (data ?? []) as Row[];
  const total = { orgs: rows.length, emp: rows.reduce((a, r) => a + r.employees_enrolled, 0), paying: rows.filter((r) => r.paid_max_employees && !r.unlimited).length,
    over: rows.filter((r) => r.over_limit).length };
  return (
    <>
      <h2>★ Plataforma</h2>
      <Flash sp={sp} />
      {error && <div className="msg error">{error.message}</div>}
      <p className="muted">Usted ve solo cifras de uso de cada organización. Sus empleados, documentos, rostros y marcaciones son privados de cada organización;
        solo puede consultarlos (en solo lectura) si la organización le concede acceso de soporte temporal.</p>
      <div className="grid">
        <div className="card kpi"><b>{total.orgs}</b><span>Organizaciones</span></div>
        <div className="card kpi"><b>{total.emp}</b><span>Empleados con rostro (total)</span></div>
        <div className="card kpi"><b>{total.paying}</b><span>Con plan de pago</span></div>
        <div className="card kpi"><b>{total.over}</b><span>Por encima de su plan</span></div>
      </div>
      <table><thead><tr><th>Organización</th><th>Estado</th><th>Uso</th><th>Plan</th><th>Actividad</th><th>Acciones</th></tr></thead><tbody>
        {rows.map((r) => {
          const [label, cls] = STATUS[r.status] ?? [r.status, ''];
          return (
            <tr key={r.id}>
              <td><b>{r.name}</b> <span className="muted">{r.country_code ?? ''}</span>
                <div className="muted" style={{ fontSize: 12 }}>{r.admin_contacts ?? 'sin administrador'}</div>
                <div className="muted" style={{ fontSize: 12 }}>Alta {day(r.created_at)} · {r.created_via === 'app_signup' ? 'registro en la app' : r.created_via === 'owner' ? 'propia' : 'plataforma'}</div>
                {r.support_until && <div><span className="badge">soporte hasta {new Date(r.support_until).toLocaleString('es')}</span> <Link href={`/?org=${r.id}`}>Ver (solo lectura)</Link></div>}
              </td>
              <td><span className={`badge ${cls}`}>{label}</span>
                {r.access === 'read_only' && r.status === 'active' && <div><span className="badge err">membresía vencida</span></div>}
                {r.suspended_reason && <div className="muted" style={{ fontSize: 12 }}>{r.suspended_reason}</div>}
                {r.deletion_due_at && <div className="muted" style={{ fontSize: 12 }}>se borra el {day(r.deletion_due_at)}</div>}
              </td>
              <td><b>{r.employees_enrolled}</b> con rostro · {r.employees_active} empleados<div className="muted" style={{ fontSize: 12 }}>{r.stores} sucursales · {r.devices_active} teléfonos</div>
                <div style={{ fontSize: 12 }}>Le corresponde: <b>{r.needed_tier_label}</b></div></td>
              <td>{r.plan_label}{r.paid_until && !r.unlimited && <div className="muted" style={{ fontSize: 12 }}>pagado hasta {day(r.paid_until)}</div>}
                {r.over_limit && <div><span className="badge warn">supera su plan</span></div>}</td>
              <td>{r.punches_30d} marcaciones / 30 días<div className="muted" style={{ fontSize: 12 }}>último teléfono: {ago(r.last_activity)}</div></td>
              <td style={{ minWidth: 260 }}>
                <form action={setPlan} className="inline" style={{ marginBottom: 6 }}><input type="hidden" name="id" value={r.id} />
                  <select name="tier" defaultValue={r.unlimited ? 'unlimited' : String(r.paid_max_employees ?? 5)}>{TIERS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                  <input type="date" name="paid_until" defaultValue={r.paid_until?.slice(0, 10) ?? ''} title="Pagado hasta (planes de pago)" />
                  <button className="secondary">Guardar plan</button>
                </form>
                {r.status === 'active' ? (
                  <form action={setStatus} className="inline"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value="suspended" />
                    <input name="reason" placeholder="motivo (p. ej. falta de pago)" required minLength={5} /><button className="danger">Suspender</button></form>
                ) : (
                  <form action={setStatus}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value="active" />
                    <button>{r.status === 'pending_deletion' ? 'Reactivar (cancelar eliminación)' : 'Reactivar'}</button></form>
                )}
              </td>
            </tr>
          );
        })}
        {rows.length === 0 && <tr><td colSpan={6} className="muted">Aún no hay organizaciones. Las empresas se registran desde la app («Crear mi organización»).</td></tr>}
      </tbody></table>
      <p className="muted">Planes por empleados con rostro registrado: 1–5 gratis; 6–10; 11–20; 21–30; 31–50 y luego de 50 en 50. Al llegar al límite la organización recibe aviso y no puede enrolar más;
        si un plan de pago vence, el panel queda en solo lectura y los teléfonos dejan de marcar. El cobro aún es manual: registre aquí el plan y la fecha «pagado hasta».</p>
      <div className="card" style={{ marginTop: 16 }}>
        <h3>Mi propia organización (sin límite)</h3>
        <p className="muted">Crea una organización a su nombre, sin límite de empleados, de la que usted es administrador central (como cualquier cliente).</p>
        <form action={createOwnOrg} className="inline">
          <label>Nombre<input name="name" required minLength={2} /></label>
          <label>País<select name="country" defaultValue="GT">{COUNTRIES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <button>Crear</button>
        </form>
      </div>
    </>
  );
}
