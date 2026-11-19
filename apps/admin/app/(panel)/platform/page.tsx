import Link from 'next/link';
import { getContext } from '@/lib/context';
import { Flash, type SP } from '@/components/Flash';
import { ago } from '@/lib/format';
import { createOwnOrg, setStatus, updateOrg } from './actions';
import { CreateOrgForm } from './CreateOrgForm';

type Row = {
  id: string; name: string; legal_name: string | null; tax_id: string | null; contact_email: string | null; contact_phone: string | null; platform_notes: string | null;
  timezone: string | null; max_employees: number | null; max_stores: number | null; max_devices: number | null; features: Record<string, boolean> | null;
  country_code: string | null; status: string; access: string; created_at: string; created_via: string;
  employees_active: number; employees_enrolled: number; stores: number; devices_active: number; punches_30d: number; last_activity: string | null;
  unlimited: boolean; paid_until: string | null; needed_tier_label: string; plan_label: string; over_limit: boolean;
  admin_contacts: string | null; support_until: string | null; deletion_due_at: string | null; suspended_reason: string | null;
};
const FEATURES: [string, string][] = [['hr', 'Expedientes y disciplina'], ['schedules', 'Horarios'], ['alerts', 'Alertas'], ['reports', 'Reportes']];
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
  const total = { orgs: rows.length, emp: rows.reduce((a, r) => a + r.employees_active, 0), paying: rows.filter((r) => r.max_employees && r.max_employees > 5 && !r.unlimited).length,
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
        <div className="card kpi"><b>{total.emp}</b><span>Empleados vigentes (total)</span></div>
        <div className="card kpi"><b>{total.paying}</b><span>Con plan de pago</span></div>
        <div className="card kpi"><b>{total.over}</b><span>Por encima de su plan</span></div>
      </div>
      <table><thead><tr><th>Organización</th><th>Estado</th><th>Uso</th><th>Plan</th><th>Actividad</th><th>Acciones</th></tr></thead><tbody>
        {rows.map((r) => {
          const [label, cls] = STATUS[r.status] ?? [r.status, ''];
          return (
            <tr key={r.id}>
              <td><b>{r.name}</b> <span className="muted">{r.country_code ?? ''} · {r.timezone ?? ''}</span>{r.legal_name && <div className="muted" style={{ fontSize: 12 }}>{r.legal_name}{r.tax_id ? ` · NIT ${r.tax_id}` : ''}</div>}
                <div className="muted" style={{ fontSize: 12 }}>{r.admin_contacts ?? 'sin administrador'}</div>
                <div className="muted" style={{ fontSize: 12 }}>Alta {day(r.created_at)} · {r.created_via === 'app_signup' ? 'registro en la app' : r.created_via === 'owner' ? 'propia' : 'plataforma'}</div>
                {r.support_until && <div><span className="badge">soporte hasta {new Date(r.support_until).toLocaleString('es')}</span> <Link href={`/?org=${r.id}`}>Ver (solo lectura)</Link></div>}
              </td>
              <td><span className={`badge ${cls}`}>{label}</span>
                {r.access === 'read_only' && r.status === 'active' && <div><span className="badge err">membresía vencida</span></div>}
                {r.suspended_reason && <div className="muted" style={{ fontSize: 12 }}>{r.suspended_reason}</div>}
                {r.deletion_due_at && <div className="muted" style={{ fontSize: 12 }}>se borra el {day(r.deletion_due_at)}</div>}
              </td>
              <td><b>{r.employees_active}</b>{r.max_employees ? ` / ${r.max_employees}` : ''} empleados vigentes · {r.employees_enrolled} con rostro<div className="muted" style={{ fontSize: 12 }}>{r.stores}{r.max_stores ? `/${r.max_stores}` : ''} sucursales · {r.devices_active}{r.max_devices ? `/${r.max_devices}` : ''} teléfonos</div>
                <div style={{ fontSize: 12 }}>Le corresponde: <b>{r.needed_tier_label}</b></div></td>
              <td>{r.plan_label}{r.paid_until && !r.unlimited && <div className="muted" style={{ fontSize: 12 }}>pagado hasta {day(r.paid_until)}</div>}
                {r.over_limit && <div><span className="badge warn">supera su plan</span></div>}</td>
              <td>{r.punches_30d} marcaciones / 30 días<div className="muted" style={{ fontSize: 12 }}>último teléfono: {ago(r.last_activity)}</div></td>
              <td style={{ minWidth: 260 }}>
                <details style={{ marginBottom: 6 }}><summary>Editar datos y límites</summary>
                  <form action={updateOrg} style={{ display: 'grid', gap: 6, marginTop: 6 }}><input type="hidden" name="id" value={r.id} />
                    <label>Razón social<input name="legal_name" defaultValue={r.legal_name ?? ''} /></label>
                    <label>NIT<input name="tax_id" defaultValue={r.tax_id ?? ''} /></label>
                    <label>Correo de contacto<input name="contact_email" type="email" defaultValue={r.contact_email ?? ''} /></label>
                    <label>Teléfono<input name="contact_phone" defaultValue={r.contact_phone ?? ''} /></label>
                    <label>Máx. empleados vigentes<input name="max_employees" type="number" min={1} defaultValue={r.max_employees ?? ''} /></label>
                    <label style={{ flexDirection: 'row', gap: 6 }}><input type="checkbox" name="unlimited" defaultChecked={r.unlimited} style={{ minWidth: 0 }} /> Sin límite</label>
                    <label>Autorizado hasta<input type="date" name="paid_until" defaultValue={r.paid_until?.slice(0, 10) ?? ''} /></label>
                    <label>Máx. sucursales<input name="max_stores" type="number" min={1} defaultValue={r.max_stores ?? ''} /></label>
                    <label>Máx. teléfonos<input name="max_devices" type="number" min={1} defaultValue={r.max_devices ?? ''} /></label>
                    <fieldset style={{ border: '1px solid #e5e7eb', borderRadius: 6 }}><legend className="muted">Módulos</legend>
                      {FEATURES.map(([k, v]) => <label key={k} style={{ flexDirection: 'row', gap: 6 }}><input type="checkbox" name={`f_${k}`} defaultChecked={r.features?.[k] !== false} style={{ minWidth: 0 }} /> {v}</label>)}</fieldset>
                    <label>Notas internas<textarea name="notes" rows={2} defaultValue={r.platform_notes ?? ''} /></label>
                    <button className="secondary">Guardar</button>
                  </form>
                </details>
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
      <p className="muted">Límites por empleados <b>vigentes</b> (activos o suspendidos; los dados de baja no consumen cupo). Tramos sugeridos: 1–5 gratis; 6–10; 11–20; 21–30; 31–50 y luego de 50 en 50.
        Al llegar al límite no se pueden dar de alta más empleados (validado en el servidor). Si la autorización vence, el panel queda en solo lectura y los teléfonos dejan de marcar.
        No hay cobro integrado: registre aquí el límite y la fecha de vencimiento.</p>
      <CreateOrgForm />
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
