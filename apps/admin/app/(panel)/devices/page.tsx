import { getContext } from '@/lib/context';
import { Flash, OrgField, type SP } from '@/components/Flash';
import { ago, fmtDateTime } from '@/lib/format';
import { createDevice, setCanEnroll, setDeviceStatus } from './actions';
import { IssueCode } from './IssueCode';

const ST: Record<string, string> = { pending: 'Pendiente de activar', active: 'Activo', blocked: 'Bloqueado', retired: 'Retirado' };

export default async function Devices({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { supabase, org, orgWide } = await getContext(sp.org);
  if (!org) return <p>Sin organización.</p>;
  const [{ data: devices }, { data: stores }, { data: health }] = await Promise.all([
    supabase.from('devices').select('*, stores(name, code)').eq('organization_id', org.id).order('created_at'),
    supabase.from('stores').select('id, name, code').eq('organization_id', org.id).eq('status', 'active').order('code'),
    supabase.from('device_health').select('device_id, reported_at, pending_events, battery_pct, free_storage_mb, recognition_model, pad_model, clock_offset_ms, flags')
      .eq('organization_id', org.id).order('reported_at', { ascending: false }).limit(500),
  ]);
  const last = new Map<string, NonNullable<typeof health>[number]>();
  for (const h of health ?? []) if (!last.has(h.device_id)) last.set(h.device_id, h);
  const manage = orgWide('device.manage');
  return (
    <>
      <h2>Teléfonos de tienda</h2>
      <Flash sp={sp} />
      <p className="muted">Cada teléfono se vincula con un código de un solo uso y genera su propia clave criptográfica. Para reinstalar o sustituir un teléfono, emita un nuevo código: la credencial anterior queda revocada.
        «Puede enrolar» habilita el registro facial (modo enrolamiento) en ese teléfono; si lo quita, deja de poder enrolar al instante aunque haya una sesión abierta. Los datos de salud son los últimos <b>reportados</b>; un teléfono sin conexión puede tener eventos pendientes no visibles aquí.</p>
      <table><thead><tr><th>Teléfono</th><th>Sede</th><th>Estado</th><th>Puede enrolar</th><th>Última sync</th><th>Pendientes (reportado)</th><th>Versiones</th><th>Acciones</th></tr></thead><tbody>
        {(devices ?? []).map((d) => {
          const h = last.get(d.id);
          return (
            <tr key={d.id}>
              <td>{d.label}<div className="muted">{d.platform ?? '—'} {d.os_version ?? ''} · {d.hardware_model ?? ''}</div></td>
              <td>{(d.stores as { code: string; name: string }).code} · {(d.stores as { name: string }).name}</td>
              <td><span className={`badge ${d.status === 'active' ? 'ok' : d.status === 'pending' ? 'warn' : 'err'}`}>{ST[d.status]}</span>{d.blocked_reason && <div className="muted">{d.blocked_reason}</div>}</td>
              <td>
                {d.can_enroll ? <span className="badge ok">Sí</span> : <span className="badge">No</span>}
                {manage && d.status !== 'retired' && (
                  <form action={setCanEnroll} style={{ marginTop: 4 }}><OrgField org={org.id} /><input type="hidden" name="id" value={d.id} />
                    <input type="hidden" name="allowed" value={d.can_enroll ? '0' : '1'} />
                    <button className={d.can_enroll ? 'danger' : 'secondary'} style={{ padding: '3px 8px', fontSize: 13 }}>{d.can_enroll ? 'Quitar permiso' : 'Permitir enrolar'}</button>
                  </form>
                )}
              </td>
              <td title={fmtDateTime(d.last_sync_at)}>{ago(d.last_sync_at)}</td>
              <td>{h?.pending_events ?? '—'}{h?.flags?.length ? <div className="muted">{h.flags.join(', ')}</div> : null}</td>
              <td className="mono">app {d.app_version ?? '—'}<br />rec {h?.recognition_model ?? '—'}<br />pad {h?.pad_model ?? '—'}</td>
              <td>{manage && (
                <div style={{ display: 'grid', gap: 6 }}>
                  {d.status !== 'retired' && d.status !== 'blocked' && <IssueCode deviceId={d.id} label={d.label} />}
                  {d.status !== 'retired' && (
                    <form action={setDeviceStatus} className="inline"><OrgField org={org.id} /><input type="hidden" name="id" value={d.id} />
                      <select name="status" defaultValue="blocked" style={{ minWidth: 100 }}><option value="blocked">Bloquear</option><option value="retired">Retirar</option></select>
                      <input name="reason" placeholder="motivo" required minLength={5} style={{ minWidth: 100 }} />
                      <button className="danger">Aplicar</button></form>
                  )}
                </div>
              )}</td>
            </tr>
          );
        })}
      </tbody></table>
      {manage && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Registrar teléfono</h3>
          <form action={createDevice} className="inline">
            <OrgField org={org.id} />
            <label>Sede<select name="store_id" required>{(stores ?? []).map((st) => <option key={st.id} value={st.id}>{st.code} · {st.name}</option>)}</select></label>
            <label>Etiqueta<input name="label" required placeholder="Teléfono caja 1" /></label>
            <button>Registrar</button>
          </form>
        </div>
      )}
    </>
  );
}
