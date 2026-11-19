import { redirect } from 'next/navigation';
import { supabaseServer } from './supabase/server';

export type Grant = { role: 'superadmin' | 'central_admin' | 'supervisor' | 'auditor'; organization_id: string | null; store_id: string | null; region_id: string | null };
export type Org = { id: string; name: string; features?: Record<string, boolean> | null };

/** Contexto del administrador autenticado. Los permisos efectivos los decide RLS; esto solo adapta la interfaz. */
export async function getContext(orgParam?: string) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const [{ data: admin }, { data: grants }, { data: orgs }, { data: perms }] = await Promise.all([
    supabase.from('admins').select('display_name, email, status').eq('user_id', user.id).maybeSingle(),
    supabase.from('admin_role_grants').select('role, organization_id, store_id, region_id').eq('user_id', user.id).is('revoked_at', null),
    supabase.from('organizations').select('id, name, features').order('name'),
    supabase.from('role_permissions').select('role, permission'),
  ]);
  const g = (grants ?? []) as Grant[];
  const isSuper = g.some((x) => x.role === 'superadmin');
  const memberOf = (id: string) => g.some((x) => x.role !== 'superadmin' && x.organization_id === id);
  // Primero las organizaciones propias del usuario; después las que le concedieron acceso de soporte.
  const orgList = ((orgs ?? []) as Org[]).sort((a, b) => Number(memberOf(b.id)) - Number(memberOf(a.id)));
  const { data: sup } = isSuper ? await supabase.from('support_access').select('organization_id, expires_at').is('revoked_at', null).gt('expires_at', new Date().toISOString())
    : { data: [] as { organization_id: string; expires_at: string }[] };
  const ROLE_LABEL: Record<string, string> = { central_admin: 'Administrador central', supervisor: 'Supervisor', auditor: 'Auditor' };
  /** Contextos disponibles para el selector (la plataforma se agrega en la interfaz si es superadministrador). */
  const contexts = orgList.map((o) => {
    const roles = [...new Set(g.filter((x) => x.role !== 'superadmin' && x.organization_id === o.id).map((x) => ROLE_LABEL[x.role] ?? x.role))];
    const until = (sup ?? []).filter((x) => x.organization_id === o.id).map((x) => x.expires_at).sort().pop() ?? null;
    return { id: o.id, name: o.name, kind: roles.length ? 'member' as const : 'support' as const, roles, supportUntil: roles.length ? null : until };
  });
  const org = orgList.find((o) => o.id === orgParam) ?? orgList[0] ?? null;
  // El superadministrador NO tiene permisos dentro de las organizaciones (solo plataforma); con acceso de soporte ve en solo lectura.
  const roles = new Set(g.filter((x) => x.role !== 'superadmin' && x.organization_id === org?.id).map((x) => x.role));
  const support = isSuper && !!org && !g.some((x) => x.role !== 'superadmin' && x.organization_id === org.id);
  const READ = ['store.read', 'employee.read', 'device.read', 'attendance.read', 'incident.read', 'audit.read', 'export.run'];
  const can = (perm: string) => (support ? READ.includes(perm) : (perms ?? []).some((p) => roles.has(p.role) && p.permission === perm));
  // ¿El permiso es a nivel de organización completa (no solo una tienda/región)?
  const orgWide = (perm: string) => (support ? READ.includes(perm) :
    g.some((x) => x.role !== 'superadmin' && x.organization_id === org?.id && !x.store_id && !x.region_id &&
      (perms ?? []).some((p) => p.role === x.role && p.permission === perm)));
  /** Módulos habilitados por el plan de la organización (ausente = habilitado). */
  const feature = (key: string) => org?.features?.[key] !== false;
  return { supabase, user, admin, grants: g, isSuper, support, orgs: orgList.map(({ id, name }) => ({ id, name })), contexts, org, can, orgWide, feature };
}

export type Ctx = Awaited<ReturnType<typeof getContext>>;

/** Mensajes de error de Postgres/RLS legibles para el usuario. */
export function humanError(e: { message?: string; code?: string } | null | undefined): string {
  if (!e) return 'Error desconocido';
  if (e.code === '42501' || /row-level security|permission denied|permiso denegado/i.test(e.message ?? '')) return 'Permiso denegado para esta operación.';
  if (e.code === '23505') return 'Ya existe un registro con esos datos (duplicado).';
  return e.message ?? 'Error';
}
