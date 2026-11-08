import Link from 'next/link';
import { getContext } from '@/lib/context';
import { Flash, OrgField, type SP } from '@/components/Flash';
import { createEmployee } from './actions';

const STATUS: Record<string, string> = { active: 'Activo', suspended: 'Suspendido', terminated: 'Baja' };

export default async function Employees({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { supabase, org, orgWide } = await getContext(sp.org);
  if (!org) return <p>Sin organización.</p>;
  let q = supabase.from('employees').select('id, employee_code, first_name, last_name, status, employee_store_assignments(store_id, revoked_at, valid_to, stores(name))')
    .eq('organization_id', org.id).order('last_name').limit(200);
  if (sp.q) q = q.or(`last_name.ilike.%${sp.q.replace(/[%,()]/g, '')}%,first_name.ilike.%${sp.q.replace(/[%,()]/g, '')}%,employee_code.ilike.%${sp.q.replace(/[%,()]/g, '')}%`);
  if (sp.status) q = q.eq('status', sp.status);
  const [{ data: emps, error }, { data: stores }] = await Promise.all([
    q, supabase.from('stores').select('id, name, code').eq('organization_id', org.id).eq('status', 'active').order('code'),
  ]);
  const now = Date.now();
  return (
    <>
      <h2>Empleados</h2>
      <Flash sp={sp} />
      {error && <div className="msg error">{error.message}</div>}
      <form className="inline card" method="get">
        <OrgField org={org.id} />
        <label>Buscar<input name="q" defaultValue={sp.q} placeholder="nombre o código" /></label>
        <label>Estado<select name="status" defaultValue={sp.status ?? ''}><option value="">Todos</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <button className="secondary">Filtrar</button>
      </form>
      <table><thead><tr><th>Código</th><th>Nombre</th><th>Sede vigente</th><th>Estado</th></tr></thead><tbody>
        {(emps ?? []).map((e) => {
          const current = (e.employee_store_assignments as unknown as { revoked_at: string | null; valid_to: string | null; stores: { name: string } | null }[])
            .filter((a) => !a.revoked_at && (!a.valid_to || new Date(a.valid_to).getTime() > now)).map((a) => a.stores?.name).join(', ');
          return (
            <tr key={e.id}><td className="mono">{e.employee_code}</td>
              <td><Link href={`/employees/${e.id}?org=${org.id}`}>{e.last_name}, {e.first_name}</Link></td>
              <td>{current || <span className="muted">sin asignación</span>}</td>
              <td><span className={`badge ${e.status === 'active' ? 'ok' : e.status === 'terminated' ? 'err' : 'warn'}`}>{STATUS[e.status]}</span></td></tr>
          );
        })}
      </tbody></table>
      {orgWide('employee.manage') && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Alta de empleado</h3>
          <p className="muted">El alta no incluye biometría. El enrolamiento facial se hace después, en la sede central.</p>
          <form action={createEmployee} className="inline">
            <OrgField org={org.id} />
            <label>Código<input name="employee_code" required /></label>
            <label>Nombre(s)<input name="first_name" required /></label>
            <label>Apellido(s)<input name="last_name" required /></label>
            <label>Últimos 4 del documento<input name="document_last4" maxLength={4} pattern="[A-Za-z0-9]{1,4}" style={{ minWidth: 90 }} /></label>
            <label>Fecha de ingreso<input type="date" name="hired_on" /></label>
            <label>Sede asignada<select name="store_id"><option value="">(asignar después)</option>{(stores ?? []).map((st) => <option key={st.id} value={st.id}>{st.code} · {st.name}</option>)}</select></label>
            <button>Crear</button>
          </form>
        </div>
      )}
    </>
  );
}
