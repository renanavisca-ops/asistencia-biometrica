import { getContext } from '@/lib/context';
import { Flash, OrgField, type SP } from '@/components/Flash';
import { fmtDateTime } from '@/lib/format';
import { grant, revoke } from './actions';

const ROLE: Record<string, string> = { superadmin: 'Superadministrador', central_admin: 'Administrador central', supervisor: 'Supervisor', auditor: 'Auditor (solo lectura)' };

export default async function Admins({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { supabase, org, orgWide, isSuper, user } = await getContext(sp.org);
  if (!org) return <p>Sin organización.</p>;
  if (!orgWide('admin.manage')) return <p>Sin permiso para gestionar administradores.</p>;
  const [{ data: grants }, { data: admins }, { data: stores }, { data: regions }] = await Promise.all([
    supabase.from('admin_role_grants').select('*, admins(display_name, email), stores(code, name), regions(name)').or(`organization_id.eq.${org.id},role.eq.superadmin`).is('revoked_at', null).order('granted_at'),
    supabase.from('admins').select('user_id, display_name, email').order('display_name'),
    supabase.from('stores').select('id, code, name').eq('organization_id', org.id).order('code'),
    supabase.from('regions').select('id, name').eq('organization_id', org.id),
  ]);
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
        <h3>Asignar rol</h3>
        <p className="muted">La persona debe tener ya una cuenta de administrador. Las invitaciones por correo aún no están implementadas: un superadministrador da de alta la cuenta (ver docs/DEPLOYMENT.md).</p>
        <form action={grant} className="inline"><OrgField org={org.id} />
          <label>Persona<select name="user_id" required>{(admins ?? []).filter((a) => a.user_id !== user.id).map((a) => <option key={a.user_id} value={a.user_id}>{a.display_name} ({a.email})</option>)}</select></label>
          <label>Rol<select name="role">{Object.entries(ROLE).filter(([k]) => k !== 'superadmin' || isSuper).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Ámbito (supervisor/auditor)<select name="scope"><option value="">Toda la organización</option>
            {(regions ?? []).map((r) => <option key={r.id} value={`r:${r.id}`}>Región {r.name}</option>)}
            {(stores ?? []).map((s) => <option key={s.id} value={`s:${s.id}`}>Sede {s.code} · {s.name}</option>)}</select></label>
          <button>Asignar</button></form>
      </div>
    </>
  );
}
