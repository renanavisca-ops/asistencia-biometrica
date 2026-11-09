import { notFound } from 'next/navigation';
import { getContext } from '@/lib/context';
import { Flash, OrgField, type SP } from '@/components/Flash';
import { fmtDateTime, fmtDuration, STATE_LABEL } from '@/lib/format';
import { revokeAssignment, setDocument, setStatus, transfer, updateEmployee } from '../actions';
import { COUNTRIES, DOC_TYPES } from '@/lib/documents';
import { RevealDocument } from './RevealDocument';

export default async function Employee({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { supabase, org, orgWide, can } = await getContext(sp.org);
  const { data: e } = await supabase.from('employees').select('*').eq('id', id).maybeSingle();
  if (!e || !org) notFound();
  const [{ data: asg }, { data: stores }, { data: enr }, { data: sessions }, { data: hist }] = await Promise.all([
    supabase.from('employee_store_assignments').select('*, stores(name, code)').eq('employee_id', id).order('valid_from', { ascending: false }),
    supabase.from('stores').select('id, name, code').eq('organization_id', e.organization_id).eq('status', 'active').order('code'),
    supabase.from('biometric_enrollments').select('id, status, enrolled_at, sample_count, pad_passed, model_versions!biometric_enrollments_recognition_model_id_fkey(name, version)').eq('employee_id', id).order('enrolled_at', { ascending: false }),
    supabase.from('attendance_sessions').select('*, stores(name)').eq('employee_id', id).order('opened_at', { ascending: false, nullsFirst: false }).limit(20),
    supabase.from('employee_status_history').select('*').eq('employee_id', id).order('changed_at', { ascending: false }),
  ]);
  const manage = orgWide('employee.manage'), assign = orgWide('assignment.manage');
  const now = Date.now();
  return (
    <>
      <h2>{e.first_name} {e.last_name} <span className="muted mono">#{e.employee_code}</span></h2>
      <Flash sp={sp} />
      <div className="grid">
        <div className="card">
          <h3>Datos</h3>
          {manage ? (
            <form action={updateEmployee} style={{ display: 'grid', gap: 8 }}>
              <OrgField org={org.id} /><input type="hidden" name="id" value={e.id} />
              <label>Código (automático, no editable)<input value={e.employee_code} disabled /></label>
              <label>Nombre(s)<input name="first_name" defaultValue={e.first_name} required /></label>
              <label>Apellido(s)<input name="last_name" defaultValue={e.last_name} required /></label>
              <label>Género (para el saludo en el teléfono)
                <select name="gender" defaultValue={e.gender ?? ''}>
                  <option value="">No indicado (saludo neutro: «Bienvenido(a)»)</option>
                  <option value="F">Femenino («Bienvenida»)</option>
                  <option value="M">Masculino («Bienvenido»)</option>
                </select>
              </label>
              <label>Fecha de ingreso<input type="date" name="hired_on" defaultValue={e.hired_on ?? ''} /></label>
              <button>Guardar</button>
            </form>
          ) : <p>{e.first_name} {e.last_name}</p>}
        </div>
        <div className="card">
          <h3>Estado laboral: {e.status}</h3>
          {manage && (
            <form action={setStatus} style={{ display: 'grid', gap: 8 }}>
              <OrgField org={org.id} /><input type="hidden" name="id" value={e.id} />
              <label>Nuevo estado<select name="status" defaultValue={e.status}>
                <option value="active">Activo</option><option value="suspended">Suspendido</option><option value="terminated">Baja (revoca asignaciones)</option></select></label>
              <label>Motivo<input name="reason" required minLength={5} /></label>
              <button className="secondary">Cambiar estado</button>
            </form>
          )}
          <ul className="muted">{(hist ?? []).map((h) => <li key={h.id}>{fmtDateTime(h.changed_at)}: {h.from_status ?? '—'} → {h.to_status} {h.reason ? `(${h.reason})` : ''}</li>)}</ul>
        </div>
      </div>

      <div className="card">
        <h3>Documento de identidad</h3>
        <p>{e.document_type ? <><b>{e.document_type}</b> ({e.document_country}) <span className="mono">••••••••{e.document_last4}</span></> : <span className="muted">Sin documento registrado.</span>}</p>
        <p className="muted">Se guarda cifrado. Ver el número completo requiere un motivo y queda registrado en la auditoría.</p>
        {manage && e.document_type && <RevealDocument employeeId={e.id} />}
        {manage && (
          <details style={{ marginTop: 10 }}><summary>{e.document_type ? 'Corregir documento' : 'Registrar documento'}</summary>
            <form action={setDocument} className="inline" style={{ marginTop: 8 }}>
              <OrgField org={org.id} /><input type="hidden" name="id" value={e.id} />
              <label>Tipo<select name="document_type" defaultValue={e.document_type ?? 'DPI'}>{DOC_TYPES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>País<select name="document_country" defaultValue={e.document_country ?? 'GT'}>{COUNTRIES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>Número<input name="document_number" required autoComplete="off" /></label>
              <label>Motivo<input name="reason" required minLength={5} /></label>
              <button className="secondary">Guardar</button>
            </form>
          </details>
        )}
      </div>

      <div className="card">
        <h3>Asignaciones de sede</h3>
        <p className="muted">Un traslado no requiere repetir el enrolamiento. Los teléfonos desconectados aplicarán el cambio en su próxima sincronización (ver docs/OFFLINE_SYNC.md).</p>
        <table><thead><tr><th>Sede</th><th>Tipo</th><th>Desde</th><th>Hasta</th><th>Estado</th><th></th></tr></thead><tbody>
          {(asg ?? []).map((a) => {
            const active = !a.revoked_at && (!a.valid_to || new Date(a.valid_to).getTime() > now) && new Date(a.valid_from).getTime() <= now;
            return (
              <tr key={a.id}><td>{(a.stores as { code: string; name: string }).code} · {(a.stores as { name: string }).name}</td>
                <td>{a.kind === 'permanent' ? 'Permanente' : 'Temporal'}</td><td>{fmtDateTime(a.valid_from)}</td><td>{fmtDateTime(a.valid_to)}</td>
                <td>{a.revoked_at ? <span className="badge">Revocada</span> : active ? <span className="badge ok">Vigente</span> : <span className="badge">Fuera de vigencia</span>}<div className="muted">{a.reason}</div></td>
                <td>{assign && !a.revoked_at && (
                  <form action={revokeAssignment} className="inline"><OrgField org={org.id} /><input type="hidden" name="id" value={e.id} />
                    <input type="hidden" name="assignment_id" value={a.id} /><input name="reason" placeholder="motivo" required minLength={5} style={{ minWidth: 100 }} />
                    <button className="secondary">Revocar</button></form>
                )}</td></tr>
            );
          })}
        </tbody></table>
        {assign && e.status !== 'terminated' && (
          <form action={transfer} className="inline" style={{ marginTop: 12 }}>
            <OrgField org={org.id} /><input type="hidden" name="id" value={e.id} />
            <label>Sede destino<select name="store_id" required>{(stores ?? []).map((st) => <option key={st.id} value={st.id}>{st.code} · {st.name}</option>)}</select></label>
            <label>Tipo<select name="kind"><option value="permanent">Traslado permanente</option><option value="temporary">Asignación temporal</option></select></label>
            <label>Desde<input type="datetime-local" name="valid_from" /></label>
            <label>Hasta (obligatorio si temporal)<input type="datetime-local" name="valid_to" /></label>
            <label>Motivo<input name="reason" required minLength={5} /></label>
            <button>Registrar</button>
          </form>
        )}
      </div>

      <div className="card">
        <h3>Biometría</h3>
        <p className="muted">El rostro se registra desde un teléfono con permiso de enrolamiento (modo administrador), verificando el documento original.
          Reconocimiento EXPERIMENTAL. La empresa es responsable de tratar estos datos conforme a la ley de su país (ver <a href="/terminos">términos</a>).</p>
        <h4>Enrolamientos</h4>
        {enr?.length ? (
          <table><thead><tr><th>Fecha</th><th>Estado</th><th>Muestras</th><th>Modelo</th></tr></thead><tbody>
            {enr.map((x) => <tr key={x.id}><td>{fmtDateTime(x.enrolled_at)}</td><td>{x.status}</td><td>{x.sample_count}</td>
              <td className="mono">{(x.model_versions as unknown as { name: string; version: string } | null)?.name}@{(x.model_versions as unknown as { version: string } | null)?.version}</td></tr>)}
          </tbody></table>
        ) : <p className="muted">Sin enrolamiento. Este empleado no podrá marcar en ningún teléfono.</p>}
      </div>

      {can('attendance.read') && (
        <div className="card">
          <h3>Últimas sesiones</h3>
          <table><thead><tr><th>Sede</th><th>Entrada</th><th>Salida</th><th>Permanencia</th><th>Estado</th></tr></thead><tbody>
            {(sessions ?? []).map((x) => <tr key={x.id}><td>{(x.stores as { name: string } | null)?.name}</td><td>{fmtDateTime(x.opened_at)}</td><td>{fmtDateTime(x.closed_at)}</td>
              <td>{fmtDuration(x.duration_seconds)}</td><td>{STATE_LABEL[x.state]}{x.needs_review && <span className="badge warn"> revisar</span>}</td></tr>)}
          </tbody></table>
        </div>
      )}
    </>
  );
}
