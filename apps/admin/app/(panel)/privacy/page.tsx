import { getContext } from '@/lib/context';
import { Flash, OrgField, type SP } from '@/components/Flash';
import { fmtDateTime } from '@/lib/format';
import { createRequest, decide } from './actions';

const KIND: Record<string, string> = { erase_biometrics: 'Borrar datos biométricos', export_data: 'Exportar datos del titular', erase_personal_data: 'Borrar datos personales' };

export default async function Privacy({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { supabase, org, orgWide, user } = await getContext(sp.org);
  if (!org) return <p>Sin organización.</p>;
  if (!orgWide('privacy.manage')) return <p>Sin permiso de privacidad.</p>;
  const [{ data: reqs }, { data: emps }] = await Promise.all([
    supabase.from('retention_requests').select('*, employees(first_name, last_name, employee_code)').eq('organization_id', org.id).order('requested_at', { ascending: false }),
    supabase.from('employees').select('id, first_name, last_name, employee_code').eq('organization_id', org.id).order('last_name'),
  ]);
  return (
    <>
      <h2>Privacidad y retención</h2>
      <Flash sp={sp} />
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
    </>
  );
}
