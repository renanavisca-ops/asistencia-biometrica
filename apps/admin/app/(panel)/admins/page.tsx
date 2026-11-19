import { getContext } from '@/lib/context';
import { Flash, OrgField, type SP } from '@/components/Flash';
import { fmtDateTime } from '@/lib/format';
import { grant, grantExtra, revoke, revokeExtra } from './actions';
import { InviteForm } from './InviteForm';

const ROLE: Record<string, string> = { superadmin: 'Superadministrador', central_admin: 'Administrador central', supervisor: 'Supervisor', auditor: 'Auditor (solo lectura)' };

export default async function Admins({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { supabase, org, orgWide, isSuper, user } = await getContext(sp.org);
  if (!org) return <p>Sin organización.</p>;
  if (!orgWide('admin.manage')) return <p>Sin permiso para gestionar administradores.</p>;
  const [{ data: grants }, { data: admins }, { data: orgs }, { data: stores }, { data: extras }] = await Promise.all([
    supabase.from('admin_role_grants').select('*, admins(display_name, email), stores(code, name), regions(name)').or(`organization_id.eq.${org.id},role.eq.superadmin`).is('revoked_at', null).order('granted_at'),
    supabase.from('admins').select('user_id, display_name, email').order('display_name'),
    isSuper ? supabase.from('organizations').select('id, name').order('name') : Promise.resolve({ data: [{ id: org.id, name: org.name }] }),
    supabase.from('stores').select('id, code, name').eq('organization_id', org.id).eq('status', 'active').order('code'),
    supabase.from('admin_permission_grants').select('id, user_id, permission, granted_at').eq('organization_id', org.id).is('revoked_at', null),
  ]);
  const orgPeople = [...new Map((grants ?? []).filter((g) => g.role !== 'superadmin' && g.role !== 'central_admin')
    .map((g) => [g.user_id, (g.admins as { display_name: string; email: string })])).entries()];
  const name = (id: string) => (admins ?? []).find((a) => a.user_id === id)?.display_name ?? id.slice(0, 8);
  return (
    <>
      <h2>Administradores y roles</h2>
      <Flash sp={sp} />
      <table><thead><tr><th>Persona</th><th>Rol</th><th>Ámbito</th><th>Desde</th><th></th></tr></thead><tbody>
        {(grants ?? []).map((g) => {
          const a = g.admins as { display_name: string; email: string };
          return (
            <tr key={g.id}><td>{a.display_name}<div className="muted">{a.email}</div></td><td>{ROLE[g.role]}</td>
              <td>{g.role === 'superadmin' ? 'Toda la plataforma' : g.stores ? `Sede ${(g.stores as { code: string }).code}` : g.regions ? `Región ${(g.regions as { name: string }).name}` : 'Toda la organización'}</td>
              <td>{fmtDateTime(g.granted_at)}</td>
              <td>{g.user_id !== user.id && (g.role !== 'superadmin' || isSuper) && (
                <form action={revoke}><OrgField org={org.id} /><input type="hidden" name="grant_id" value={g.id} /><button className="secondary">Revocar</button></form>
              )}</td></tr>
          );
        })}
      </tbody></table>
      <div className="card" style={{ marginTop: 16 }}>
        <h3>Permisos especiales</h3>
        <p className="muted"><b>Ver motivos de baja</b>: los motivos, comentarios y documentos de una salida (renuncia, despido, etc.) solo los ve la administración central.
          Puede concedérselo a un supervisor o auditor concreto; verá los motivos únicamente de los empleados que ya puede ver. Queda en la auditoría.</p>
        <table><thead><tr><th>Persona</th><th>Permiso</th><th>Desde</th><th></th></tr></thead><tbody>
          {(extras ?? []).map((x) => (
            <tr key={x.id}><td>{name(x.user_id)}</td><td>Ver motivos de baja</td><td>{fmtDateTime(x.granted_at)}</td>
              <td><form action={revokeExtra}><OrgField org={org.id} /><input type="hidden" name="grant_id" value={x.id} /><button className="secondary">Retirar</button></form></td></tr>
          ))}
          {!extras?.length && <tr><td colSpan={4} className="muted">Nadie fuera de la administración central tiene este permiso.</td></tr>}
        </tbody></table>
        {orgPeople.length > 0 && (
          <form action={grantExtra} className="inline" style={{ marginTop: 8 }}><OrgField org={org.id} />
            <label>Persona<select name="user_id" required>{orgPeople.filter(([id]) => !(extras ?? []).some((x) => x.user_id === id))
              .map(([id, a]) => <option key={id} value={id}>{a.display_name} ({a.email})</option>)}</select></label>
            <button>Conceder «ver motivos de baja»</button>
          </form>
        )}
      </div>
      <InviteForm orgs={(orgs ?? []) as { id: string; name: string }[]} defaultOrg={org.id} isSuper={isSuper} />
      <details className="card" style={{ marginTop: 16 }}>
        <summary>Asignar rol a una cuenta existente</summary>
        <form action={grant} className="inline" style={{ marginTop: 8 }}><OrgField org={org.id} />
          <label>Persona<select name="user_id" required>{(admins ?? []).filter((a) => a.user_id !== user.id).map((a) => <option key={a.user_id} value={a.user_id}>{a.display_name} ({a.email})</option>)}</select></label>
          <label>Rol<select name="role">
            <option value="central_admin">Administrador central</option>
            <option value="supervisor">Supervisor (solo la sucursal elegida)</option>
            <option value="auditor">Auditor (solo lectura)</option>
            {isSuper && <option value="superadmin">Superadministrador</option>}
          </select></label>
          <label>Ámbito (supervisor)<select name="scope" defaultValue=""><option value="">Toda la organización</option>
            {(stores ?? []).map((st) => <option key={st.id} value={`s:${st.id}`}>Sucursal {st.code} · {st.name}</option>)}</select></label>
          <button>Asignar</button></form>
        <p className="muted">El supervisor ve la asistencia, alertas y expedientes solo de los empleados de sus sucursales y puede registrar llamadas de atención;
          no da de baja, no anula registros ni genera reportes. El auditor solo consulta. Para invitar a una persona nueva como supervisor, invítela primero y luego asígnele el rol aquí.</p>
      </details>
    </>
  );
}
