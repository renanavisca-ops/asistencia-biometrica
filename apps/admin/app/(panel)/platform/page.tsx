import Link from 'next/link';
import { getContext } from '@/lib/context';
import { Flash, type SP } from '@/components/Flash';

type Org = { id: string; name: string; status: string; access: string; employees_active: number; max_employees: number | null; unlimited: boolean;
  paid_until: string | null; over_limit: boolean; punches_30d: number; last_activity: string | null; created_at: string; created_via: string };
type Month = { month: string; new_orgs: number; total_orgs: number; active_orgs: number; employees: number; punches: number };

/** Resumen de la plataforma como negocio: solo cifras agregadas (sin datos laborales ni biométricos). */
export default async function PlatformHome({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { supabase, isSuper } = await getContext();
  if (!isSuper) return <p>Esta área es exclusiva del propietario de la plataforma.</p>;
  const [{ data: orgs, error }, { data: growth }] = await Promise.all([supabase.rpc('platform_orgs'), supabase.rpc('platform_growth', { p_months: 12 })]);
  const rows = (orgs ?? []) as Org[];
  const g = (growth ?? []) as Month[];
  const soon = Date.now() + 7 * 864e5;
  const k = {
    total: rows.length, active: rows.filter((r) => r.status === 'active' && r.access === 'full').length,
    suspended: rows.filter((r) => r.status === 'suspended').length, readOnly: rows.filter((r) => r.status === 'active' && r.access === 'read_only').length,
    employees: rows.reduce((a, r) => a + r.employees_active, 0), punches: rows.reduce((a, r) => a + r.punches_30d, 0),
    over: rows.filter((r) => r.over_limit).length, expiring: rows.filter((r) => r.paid_until && new Date(r.paid_until).getTime() < soon && new Date(r.paid_until).getTime() > Date.now()).length,
    signup: rows.filter((r) => r.created_via === 'app_signup').length, used30: rows.filter((r) => r.punches_30d > 0).length,
  };
  const maxP = Math.max(1, ...g.map((m) => m.punches));
  const near = rows.filter((r) => !r.unlimited && r.max_employees && r.employees_active >= Math.ceil(r.max_employees * 0.8)).sort((a, b) => b.employees_active / (b.max_employees ?? 1) - a.employees_active / (a.max_employees ?? 1));
  return (
    <>
      <h2>Resumen de la plataforma</h2>
      <Flash sp={sp} />
      {error && <div className="msg error">{error.message}</div>}
      <div className="grid">
        <div className="card kpi"><b>{k.total}</b><span>Organizaciones ({k.signup} por registro en la app)</span></div>
        <div className="card kpi"><b>{k.active}</b><span>Activas</span></div>
        <div className="card kpi"><b>{k.used30}</b><span>Con uso en los últimos 30 días</span></div>
        <div className="card kpi"><b>{k.suspended + k.readOnly}</b><span>Suspendidas o vencidas</span></div>
        <div className="card kpi"><b>{k.employees}</b><span>Empleados vigentes (todas)</span></div>
        <div className="card kpi"><b>{k.punches}</b><span>Marcaciones en 30 días</span></div>
        <div className="card kpi"><Link href="/platform/organizations"><b>{k.over}</b></Link><span>Por encima de su límite</span></div>
        <div className="card kpi"><b>{k.expiring}</b><span>Vencen en 7 días</span></div>
      </div>
      <h3>Crecimiento (12 meses)</h3>
      <table><thead><tr><th>Mes</th><th>Nuevas</th><th>Total organizaciones</th><th>Con uso</th><th>Empleados vigentes</th><th>Marcaciones</th></tr></thead><tbody>
        {g.map((m) => (
          <tr key={m.month}><td>{m.month}</td><td>{m.new_orgs}</td><td>{m.total_orgs}</td><td>{m.active_orgs}</td><td>{m.employees}</td>
            <td><span className="bar" style={{ width: `${Math.round((m.punches / maxP) * 160)}px` }} /> {m.punches}</td></tr>
        ))}
      </tbody></table>
      <h3>Cerca o por encima de su límite</h3>
      {near.length ? (
        <table><thead><tr><th>Organización</th><th>Empleados vigentes</th><th>Autorizado hasta</th></tr></thead><tbody>
          {near.map((r) => <tr key={r.id}><td>{r.name}</td><td>{r.employees_active} / {r.max_employees}</td><td>{r.paid_until ? new Date(r.paid_until).toLocaleDateString('es') : '—'}</td></tr>)}
        </tbody></table>
      ) : <p className="muted">Ninguna organización está cerca de su límite.</p>}
      <p className="muted">Cifras agregadas de uso. Los datos laborales, expedientes y biometría de cada organización no están disponibles en esta área;
        para soporte técnico la organización debe conceder un acceso temporal, que queda registrado en su auditoría.</p>
    </>
  );
}
