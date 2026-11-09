import { getContext } from '@/lib/context';
import { Flash, OrgField, type SP } from '@/components/Flash';
import { fmtDateTime } from '@/lib/format';
import { cancelDeletion, createRequest, decide, grantSupport, requestDeletion, revokeSupport } from './actions';

const KIND: Record<string, string> = { erase_biometrics: 'Borrar datos biométricos', export_data: 'Exportar datos del titular', erase_personal_data: 'Borrar datos personales' };

export default async function Privacy({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { supabase, org, orgWide, user } = await getContext(sp.org);
  if (!org) return <p>Sin organización.</p>;
  if (!orgWide('privacy.manage')) return <p>Sin permiso de privacidad.</p>;
  const [{ data: reqs }, { data: emps }, { data: orgRow }, { data: support }] = await Promise.all([
    supabase.from('retention_requests').select('*, employees(first_name, last_name, employee_code)').eq('organization_id', org.id).order('requested_at', { ascending: false }),
    supabase.from('employees').select('id, first_name, last_name, employee_code').eq('organization_id', org.id).order('last_name'),
    supabase.from('organizations').select('status, deletion_due_at').eq('id', org.id).maybeSingle(),
    supabase.from('support_access').select('expires_at, reason').eq('organization_id', org.id).is('revoked_at', null).gt('expires_at', new Date().toISOString()).order('expires_at', { ascending: false }).limit(1),
  ]);
  const sup = support?.[0];
  return (
    <>
      <h2>Privacidad y cuenta</h2>
      <Flash sp={sp} />
      <div className="card">
        <h3>Descargar sus datos</h3>
        <p className="muted">Sus datos le pertenecen. La plataforma no es un archivo de conservación de registros laborales: descárguelos periódicamente y consérvelos
          durante los plazos que exige la ley de su país (ver <a href="/terminos">términos</a>). Disponible aunque la cuenta esté en solo lectura.</p>
        <p><a href={`/api/export?type=days&org=${org.id}&from=2000-01-01&to=${new Date().toISOString().slice(0, 10)}`}>Jornadas (CSV)</a>{' · '}
          <a href={`/api/export?type=events&org=${org.id}&from=2000-01-01&to=${new Date().toISOString().slice(0, 10)}`}>Todas las marcaciones (CSV)</a>{' · '}
          <a href={`/api/export?type=sessions&org=${org.id}&from=2000-01-01&to=${new Date().toISOString().slice(0, 10)}`}>Entradas y salidas (CSV)</a></p>
      </div>
      <div className="card">
        <h3>Acceso de soporte</h3>
        {sup ? (
          <form action={revokeSupport} className="inline"><OrgField org={org.id} />
            <span>El proveedor puede ver sus datos (solo lectura) hasta el <b>{fmtDateTime(sup.expires_at)}</b>{sup.reason ? ` — ${sup.reason}` : ''}.</span>
            <button className="danger">Retirar acceso ahora</button></form>
        ) : (
          <form action={grantSupport} className="inline"><OrgField org={org.id} />
            <span className="muted">Si necesita ayuda, puede permitir que el proveedor vea sus datos en solo lectura por un tiempo limitado. Queda en su auditoría.</span>
            <label>Duración<select name="hours" defaultValue="24"><option value="2">2 horas</option><option value="24">24 horas</option><option value="72">3 días</option></select></label>
            <label>Motivo<input name="reason" placeholder="p. ej. revisar un reporte" /></label>
            <button className="secondary">Conceder acceso</button></form>
        )}
      </div>
      <div className="notice">Hoy se ejecuta automáticamente el <b>borrado de datos biométricos</b> (plantillas, enrolamiento y retiro del consentimiento; los teléfonos los eliminan en su próxima sincronización).
        La exportación y el borrado de datos personales quedan registrados para ejecución manual: las marcaciones son registros laborales cuya retención depende de la legislación de cada país (pendiente de revisión legal).</div>
      <table><thead><tr><th>Fecha</th><th>Empleado</th><th>Tipo</th><th>Motivo</th><th>Estado</th><th></th></tr></thead><tbody>
        {(reqs ?? []).map((r) => {
          const e = r.employees as { first_name: string; last_name: string; employee_code: string };
          return (
            <tr key={r.id}><td>{fmtDateTime(r.requested_at)}</td><td>{e.last_name}, {e.first_name}</td><td>{KIND[r.kind]}</td><td>{r.reason}</td><td>{r.status}{r.notes && <div className="muted">{r.notes}</div>}</td>
              <td>{r.status === 'requested' && r.requested_by !== user.id && (
                <form action={decide} className="inline"><OrgField org={org.id} /><input type="hidden" name="id" value={r.id} />
                  <input name="notes" placeholder="notas" /><button name="approve" value="true">Aprobar</button><button name="approve" value="false" className="secondary">Rechazar</button></form>
              )}{r.status === 'requested' && r.requested_by === user.id && <span className="muted">pendiente de otra persona</span>}</td></tr>
          );
        })}
      </tbody></table>
      <div className="card" style={{ marginTop: 16 }}>
        <h3>Nueva solicitud del titular</h3>
        <form action={createRequest} className="inline"><OrgField org={org.id} />
          <label>Empleado<select name="employee_id" required>{(emps ?? []).map((e) => <option key={e.id} value={e.id}>{e.last_name}, {e.first_name} #{e.employee_code}</option>)}</select></label>
          <label>Tipo<select name="kind">{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Motivo<input name="reason" required /></label>
          <button>Registrar</button></form>
      </div>
      <div className="card" style={{ marginTop: 16, borderColor: 'var(--danger)' }}>
        <h3>Eliminar la cuenta de la organización</h3>
        {orgRow?.status === 'pending_deletion' ? (
          <form action={cancelDeletion} className="inline"><OrgField org={org.id} />
            <span>Eliminación programada: todo se borrará definitivamente el <b>{fmtDateTime(orgRow.deletion_due_at)}</b>. Mientras tanto puede descargar sus datos.</span>
            <button>Cancelar la eliminación</button></form>
        ) : (
          <form action={requestDeletion} className="inline"><OrgField org={org.id} />
            <span className="muted">Se detienen los teléfonos y el panel queda en solo lectura. <b>Sus datos se conservarán 90 días</b> por si desea volver a suscribirse;
              después se borrarán de forma definitiva (empleados, documentos, rostros, marcaciones y cuentas). Descargue antes lo que necesite conservar.</span>
            <label>Escriba «{org.name}» para confirmar<input name="confirm" required autoComplete="off" /></label>
            <button className="danger">Eliminar cuenta</button></form>
        )}
      </div>
    </>
  );
}
