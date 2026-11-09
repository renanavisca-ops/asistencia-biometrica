import Link from 'next/link';
import { getContext } from '@/lib/context';
import { ago } from '@/lib/format';
import type { SP } from '@/components/Flash';
import { PresenceNow } from '@/components/PresenceNow';

export default async function Home({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { supabase, org, isSuper } = await getContext(sp.org);
  if (!org) {
    return (
      <div className="card">
        <h2>Bienvenido</h2>
        <p>No hay organizaciones visibles todavía.</p>
        {isSuper && <p>Como superadministrador usted ve el uso de las organizaciones en <Link href="/platform">★ Plataforma</Link>. No ve sus datos salvo que una organización le conceda acceso de soporte. Para su propia empresa, créela allí (sin límite).</p>}
      </div>
    );
  }
  const since = new Date(); since.setHours(0, 0, 0, 0);
  const staleCut = new Date(Date.now() - 24 * 3600e3).toISOString();
  const [emp, stores, devices, inc, today, review, staleDev] = await Promise.all([
    supabase.from('employees').select('id', { count: 'exact', head: true }).eq('organization_id', org.id).eq('status', 'active'),
    supabase.from('stores').select('id', { count: 'exact', head: true }).eq('organization_id', org.id).eq('status', 'active'),
    supabase.from('devices').select('id', { count: 'exact', head: true }).eq('organization_id', org.id).eq('status', 'active'),
    supabase.from('incidents').select('id', { count: 'exact', head: true }).eq('organization_id', org.id).eq('status', 'open'),
    supabase.from('attendance_events').select('id', { count: 'exact', head: true }).eq('organization_id', org.id).gte('occurred_at', since.toISOString()),
    supabase.from('attendance_events').select('id', { count: 'exact', head: true }).eq('organization_id', org.id).eq('status', 'needs_review'),
    supabase.from('devices').select('id, label, last_sync_at, stores(name)').eq('organization_id', org.id).eq('status', 'active')
      .or(`last_sync_at.is.null,last_sync_at.lt.${staleCut}`).limit(20),
  ]);
  const q = `?org=${org.id}`;
  return (
    <>
      <h2>{org.name}</h2>
      <div className="notice">
        <b>Reconocimiento facial EXPERIMENTAL</b> (motor gratuito SFace + prueba de vida MiniFASNet y desafío activo). Umbrales provisionales,
        sin calibración con voluntarios: no apto todavía para uso productivo. Ver docs/PRUEBAS_RECONOCIMIENTO.md.
      </div>
      <div className="grid">
        <div className="card kpi"><b>{emp.count ?? 0}</b><span>Empleados activos</span></div>
        <div className="card kpi"><b>{stores.count ?? 0}</b><span>Sedes activas</span></div>
        <div className="card kpi"><b>{devices.count ?? 0}</b><span>Teléfonos activos</span></div>
        <div className="card kpi"><b>{today.count ?? 0}</b><span>Marcaciones hoy (recibidas)</span></div>
        <div className="card kpi"><Link href={`/incidents${q}`}><b>{inc.count ?? 0}</b></Link><span>Incidencias abiertas</span></div>
        <div className="card kpi"><b>{review.count ?? 0}</b><span>Eventos en revisión</span></div>
      </div>
      <PresenceNow sb={supabase} org={org.id} />
      <h3>Teléfonos sin sincronizar en 24 h</h3>
      {staleDev.data?.length ? (
        <table><thead><tr><th>Teléfono</th><th>Sede</th><th>Última sincronización</th></tr></thead><tbody>
          {staleDev.data.map((d) => (
            <tr key={d.id}><td>{d.label}</td><td>{(d.stores as unknown as { name: string } | null)?.name}</td><td>{ago(d.last_sync_at)}</td></tr>
          ))}
        </tbody></table>
      ) : <p className="muted">Todos los teléfonos activos han sincronizado en las últimas 24 h.</p>}
      <p className="muted">Nota: “Marcaciones hoy” cuenta solo eventos ya sincronizados; los teléfonos sin conexión pueden tener eventos pendientes.</p>
    </>
  );
}
