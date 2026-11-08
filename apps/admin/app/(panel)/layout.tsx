import { Suspense, type ReactNode } from 'react';
import { getContext } from '@/lib/context';
import { Nav } from '@/components/Nav';

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
      <Suspense><Nav orgs={ctx.orgs} who={`${ctx.admin.display_name} · ${ctx.grants.map((g) => g.role).join(', ')}`} /></Suspense>
      <main>{children}</main>
    </div>
  );
}
