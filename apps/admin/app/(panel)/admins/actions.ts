'use server';
import { supabaseServer } from '@/lib/supabase/server';
import { back, s } from '@/lib/actions';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';

export async function grant(fd: FormData) {
  const sb = await supabaseServer();
  const scope = s(fd, 'scope');
  const { error } = await sb.rpc('grant_role', {
    p_user_id: s(fd, 'user_id'), p_role: s(fd, 'role'), p_org: s(fd, 'org'),
    p_region: scope?.startsWith('r:') ? scope.slice(2) : null, p_store: scope?.startsWith('s:') ? scope.slice(2) : null,
  });
  back('/admins', fd, error, 'Rol asignado');
}

export async function revoke(fd: FormData) {
  const sb = await supabaseServer();
  const { error } = await sb.rpc('revoke_role', { p_grant_id: s(fd, 'grant_id') });
  back('/admins', fd, error, 'Rol revocado');
}

export type InviteState = { status: 'idle' | 'ok' | 'error'; message?: string; link?: string | null; email?: string };

/** Invitación: la Edge Function admin-invite comprueba permisos con esta sesión y genera el enlace (sin correo automático). */
export async function invite(_prev: InviteState, fd: FormData): Promise<InviteState> {
  const sb = await supabaseServer();
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const email = (s(fd, 'email') ?? '').trim().toLowerCase();
  const { data, error } = await sb.functions.invoke('admin-invite', {
    body: { email, name: s(fd, 'name'), role: s(fd, 'role') ?? 'central_admin', organizationId: s(fd, 'invite_org'), redirectTo: `https://${host}/auth/accept` },
  });
  if (error) {
    let msg = 'No se pudo crear la invitación.';
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error; } catch { /* sin detalle */ }
    return { status: 'error', message: msg };
  }
  revalidatePath('/admins');
  const r = data as { existing: boolean; link: string | null };
  return { status: 'ok', email, link: r.link,
    message: r.existing ? 'La persona ya tenía cuenta: se le asignó el rol. Puede entrar con su contraseña actual.' : 'Invitación creada. Envíe este enlace a la persona (WhatsApp o correo). Sirve una sola vez y vence (normalmente en 24 horas): úselo cuanto antes.' };
}
