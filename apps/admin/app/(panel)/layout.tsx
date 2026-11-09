import { Suspense, type ReactNode } from 'react';
import { getContext } from '@/lib/context';
import { Nav } from '@/components/Nav';
import { PlanBanner } from '@/components/PlanBanner';

export const dynamic = 'force-dynamic';

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const ctx = await getContext();
  if (!ctx.admin || ctx.grants.length === 0) {
    return (
      <main style={{ maxWidth: 560, margin: '10vh auto' }}>
        <div className="card">
          <h2>Cuenta sin rol asignado</h2>
          <p>Su cuenta ({ctx.user.email}) está autenticada pero no tiene un rol administrativo activo. Solicite acceso a un administrador central.</p>
          <form action="/logout" method="post"><button className="secondary">Cerrar sesión</button></form>
        </div>
      </main>
    );
  }
  return (
    <div className="shell">
      <Suspense><Nav orgs={ctx.orgs} isSuper={ctx.isSuper} who={`${ctx.admin.display_name} · ${ctx.grants.map((g) => g.role).join(', ')}`} /></Suspense>
      <main>
        <Suspense><PlanBanner orgs={ctx.orgs.map((o) => o.id)} supportOrgs={ctx.isSuper ? ctx.orgs.filter((o) => !ctx.grants.some((g) => g.role !== 'superadmin' && g.organization_id === o.id)).map((o) => o.id) : []} /></Suspense>
        {children}
      </main>
    </div>
  );
}
