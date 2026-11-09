'use client';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

const LINKS: [string, string][] = [
  ['/', 'Inicio'], ['/attendance', 'Asistencia'], ['/incidents', 'Incidencias'], ['/employees', 'Empleados'],
  ['/organizations', 'Sucursales'], ['/devices', 'Teléfonos'], ['/settings', 'Política offline'],
  ['/admins', 'Administradores'], ['/privacy', 'Privacidad y cuenta'], ['/audit', 'Auditoría'],
];

export function Nav({ orgs, who, isSuper }: { orgs: { id: string; name: string }[]; who: string; isSuper: boolean }) {
  const sp = useSearchParams();
  const path = usePathname();
  const router = useRouter();
  const org = sp.get('org') ?? orgs[0]?.id ?? '';
  const q = org ? `?org=${org}` : '';
  return (
    <nav className="side">
      <h1>Asistencia · Central</h1>
      {orgs.length > 1 && (
        <select value={org} onChange={(e) => router.push(`${path}?org=${e.target.value}`)} style={{ width: '100%', marginBottom: 12 }}>
          {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      )}
      {orgs.length === 1 && <div className="who" style={{ margin: '0 6px 12px', color: '#fff' }}>{orgs[0]!.name}</div>}
      {isSuper && <Link href="/platform" style={path === '/platform' ? { background: '#1f2937', color: '#fff' } : { fontWeight: 700 }}>★ Plataforma</Link>}
      {orgs.length > 0 && LINKS.map(([href, label]) => (
        <Link key={href} href={href + q} style={path === href ? { background: '#1f2937', color: '#fff' } : undefined}>{label}</Link>
      ))}
      <Link href="/terminos" style={{ fontSize: 13, opacity: 0.8 }}>Términos y condiciones</Link>
      <form action="/logout" method="post" style={{ marginTop: 16 }}><button className="secondary" style={{ width: '100%' }}>Cerrar sesión</button></form>
      <div className="who">{who}</div>
    </nav>
  );
}
