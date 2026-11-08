import { getContext } from '@/lib/context';
import { OrgField, type SP } from '@/components/Flash';
import { fmtDateTime } from '@/lib/format';

export default async function Audit({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { supabase, org, can } = await getContext(sp.org);
  if (!org) return <p>Sin organización.</p>;
  if (!can('audit.read')) return <p>Sin permiso de auditoría.</p>;
  let q = supabase.from('audit_log').select('*').eq('organization_id', org.id).order('at', { ascending: false }).limit(300);
  if (sp.entity) q = q.eq('entity', sp.entity);
  const [{ data: log }, { data: sec }, { data: admins }] = await Promise.all([
    q,
    supabase.from('security_events').select('*').eq('organization_id', org.id).order('created_at', { ascending: false }).limit(100),
    supabase.from('admins').select('user_id, display_name'),
  ]);
  const who = new Map((admins ?? []).map((a) => [a.user_id, a.display_name]));
  return (
    <>
      <h2>Auditoría</h2>
      <form className="inline card" method="get"><OrgField org={org.id} />
        <label>Entidad<input name="entity" defaultValue={sp.entity} placeholder="employees, attendance_corrections…" /></label>
        <button className="secondary">Filtrar</button></form>
      <h3>Eventos de seguridad</h3>
      <table><thead><tr><th>Fecha</th><th>Tipo</th><th>Dispositivo</th><th>Detalle</th></tr></thead><tbody>
        {(sec ?? []).map((e) => <tr key={e.id}><td>{fmtDateTime(e.created_at)}</td><td>{e.kind}</td><td className="mono">{e.device_id?.slice(0, 8)}</td><td className="mono">{JSON.stringify(e.details)}</td></tr>)}
      </tbody></table>
      <h3>Registro de cambios</h3>
      <table><thead><tr><th>Fecha</th><th>Actor</th><th>Acción</th><th>Entidad</th><th>Cambio</th></tr></thead><tbody>
        {(log ?? []).map((l) => (
          <tr key={l.id}><td>{fmtDateTime(l.at)}</td><td>{l.actor ? who.get(l.actor) ?? l.actor.slice(0, 8) : l.actor_kind}</td><td>{l.action}</td>
            <td>{l.entity} <span className="mono muted">{String(l.entity_id ?? '').slice(0, 8)}</span></td>
            <td><details><summary className="muted">ver</summary><pre className="mono" style={{ whiteSpace: 'pre-wrap', maxWidth: 520 }}>{JSON.stringify({ antes: l.before, despues: l.after }, null, 1)}</pre></details></td></tr>
        ))}
      </tbody></table>
    </>
  );
}
