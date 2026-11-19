import { getContext } from '@/lib/context';
import type { SP } from '@/components/Flash';
import { fmtDateTime } from '@/lib/format';

const ACTION: Record<string, string> = {
  platform_create_org: 'Creó organización', platform_update_org: 'Editó datos / límites', platform_apply_plan: 'Aplicó plan',
  platform_save_plan: 'Guardó plan', platform_set_plan: 'Cambió plan', platform_set_status: 'Cambió estado', purge_org: 'Borrado definitivo',
};

/** Acciones administrativas de la plataforma (no incluye la auditoría interna de cada organización). */
export default async function PlatformAudit({ searchParams }: { searchParams: SP }) {
  await searchParams;
  const { supabase, isSuper } = await getContext();
  if (!isSuper) return <p>Esta área es exclusiva del propietario de la plataforma.</p>;
  const [{ data: rows }, { data: orgs }, { data: admins }] = await Promise.all([
    supabase.from('audit_log').select('id, actor, action, entity, entity_id, after, at').is('organization_id', null).order('at', { ascending: false }).limit(300),
    supabase.rpc('platform_orgs'), supabase.from('admins').select('user_id, display_name'),
  ]);
  const orgName = (id: string | null) => ((orgs ?? []) as { id: string; name: string }[]).find((o) => o.id === id)?.name;
  const who = (id: string | null) => (admins ?? []).find((a) => a.user_id === id)?.display_name ?? (id ? id.slice(0, 8) : 'sistema');
  return (
    <>
      <h2>Auditoría de plataforma</h2>
      <p className="muted">Acciones del propietario sobre organizaciones y planes. Lo que ocurre dentro de cada organización (incluidos los ingresos de soporte) queda en la auditoría de esa organización.</p>
      <table><thead><tr><th>Fecha</th><th>Quién</th><th>Acción</th><th>Sobre</th><th>Detalle</th></tr></thead><tbody>
        {(rows ?? []).map((r) => (
          <tr key={r.id}><td>{fmtDateTime(r.at)}</td><td>{who(r.actor)}</td><td>{ACTION[r.action] ?? r.action}</td>
            <td>{r.entity === 'organizations' ? orgName(r.entity_id) ?? r.entity_id : r.entity}</td>
            <td className="mono" style={{ maxWidth: 420, overflowWrap: 'anywhere' }}>{r.after ? JSON.stringify(r.after) : ''}</td></tr>
        ))}
        {!rows?.length && <tr><td colSpan={5} className="muted">Sin acciones registradas.</td></tr>}
      </tbody></table>
    </>
  );
}
