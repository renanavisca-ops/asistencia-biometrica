'use client';
import Link from 'next/link';
import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export type CtxOption = { id: string; name: string; kind: 'member' | 'support'; roles: string[]; supportUntil: string | null };

/** Menú de la organización (operación laboral). */
const ORG_LINKS: [string, string][] = [
  ['/', 'Inicio'], ['/attendance', 'Asistencia'], ['/incidents', 'Incidencias'], ['/employees', 'Empleados'],
  ['/schedules', 'Horarios'], ['/alerts', 'Alertas'], ['/discipline', 'Disciplina'], ['/reports', 'Reportes'],
  ['/organizations', 'Sucursales'], ['/devices', 'Teléfonos'], ['/biometrics', 'Validación biométrica'], ['/settings', 'Política offline'],
  ['/admins', 'Administradores y permisos'], ['/privacy', 'Privacidad y cuenta'], ['/audit', 'Auditoría'],
];
/** Menú de la plataforma (el negocio: organizaciones, planes, crecimiento). */
const PLATFORM_LINKS: [string, string][] = [
  ['/platform', 'Resumen'], ['/platform/organizations', 'Organizaciones'], ['/platform/plans', 'Planes'], ['/platform/audit', 'Auditoría de plataforma'],
];

export function Nav({ contexts, who, isSuper }: { contexts: CtxOption[]; who: string; isSuper: boolean }) {
  const sp = useSearchParams();
  const path = usePathname();
  const router = useRouter();
  const inPlatform = path.startsWith('/platform');
  const org = sp.get('org') ?? contexts[0]?.id ?? '';
  const current = inPlatform ? '__platform' : org;
  const q = org ? `?org=${org}` : '';
  const options = [...(isSuper ? [{ value: '__platform', label: '★ Mi plataforma (administración global)' }] : []),
    ...contexts.map((c) => ({ value: c.id, label: c.kind === 'support' ? `🛟 ${c.name} — soporte, solo lectura` : `🏢 ${c.name}` }))];
  const go = (v: string) => router.push(v === '__platform' ? '/platform' : `/?org=${v}`);
  const links = inPlatform ? PLATFORM_LINKS : contexts.length ? ORG_LINKS : [];
  const active = (href: string) => (href === '/' || href === '/platform' ? path === href : path.startsWith(href));
  return (
    <nav className={`side ${inPlatform ? 'side-platform' : ''}`}>
      <h1>Asistencia Tienda</h1>
      <div className="ctx-label">{inPlatform ? 'Área: plataforma' : 'Área: organización'}</div>
      {options.length > 1 ? (
        <select aria-label="Cambiar de área" value={current} onChange={(e) => go(e.target.value)} className="ctx-select">
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : options[0] && <div className="ctx-single">{options[0].label}</div>}
      {links.map(([href, label]) => (
        <Link key={href} href={inPlatform ? href : href + q} className={active(href) ? 'on' : undefined}>{label}</Link>
      ))}
      <Link href="/terminos" style={{ fontSize: 13, opacity: 0.8, marginTop: 8 }}>Términos y condiciones</Link>
      <form action="/logout" method="post" style={{ marginTop: 16 }}><button className="secondary" style={{ width: '100%' }}>Cerrar sesión</button></form>
      <div className="who">{who}</div>
    </nav>
  );
}

/** Franja superior que indica siempre en qué área y organización se trabaja (y si es acceso de soporte). */
export function ContextBar({ contexts, isSuper, onSupport }: { contexts: CtxOption[]; isSuper: boolean; onSupport: (org: string, path: string) => Promise<void> }) {
  const sp = useSearchParams();
  const path = usePathname();
  const c = contexts.find((x) => x.id === sp.get('org')) ?? contexts[0];
  const supportOrg = !path.startsWith('/platform') && c?.kind === 'support' ? c.id : null;
  useEffect(() => { if (supportOrg) void onSupport(supportOrg, path); }, [supportOrg, path, onSupport]);
  if (path.startsWith('/platform')) {
    return <div className="ctxbar ctx-platform">★ <b>Administración global de la plataforma</b> · organizaciones, planes y uso. Aquí no se muestran expedientes, asistencia ni datos biométricos de las organizaciones.</div>;
  }
  if (!c) return isSuper ? <div className="ctxbar ctx-platform">No administra ninguna organización. Use ★ Mi plataforma o cree su organización propia en Plataforma › Organizaciones.</div> : null;
  if (c.kind === 'support') {
    return <div className="ctxbar ctx-support">🛟 <b>Acceso de soporte a {c.name}</b> · solo lectura{c.supportUntil ? <> hasta <span suppressHydrationWarning>{new Date(c.supportUntil).toLocaleString('es')}</span></> : ''}.
      Concedido por la organización; su ingreso queda registrado en la auditoría de la organización. Sin acceso a expedientes ni biometría.</div>;
  }
  return <div className="ctxbar ctx-org">🏢 <b>{c.name}</b> · {c.roles.join(', ')}</div>;
}
