'use server';
import { supabaseServer } from '@/lib/supabase/server';
import { back, s } from '@/lib/actions';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';

const FEATURES = ['hr', 'schedules', 'alerts', 'reports'] as const;
const num = (fd: FormData, k: string) => { const v = s(fd, k); return v ? Number(v) : null; };
const until = (fd: FormData) => { const v = s(fd, 'paid_until'); return v ? new Date(v + 'T23:59:59').toISOString() : null; };

export async function updateOrg(fd: FormData) {
  const sb = await supabaseServer();
  const features = Object.fromEntries(FEATURES.filter((f) => fd.get(`f_${f}`) !== 'on').map((f) => [f, false]));
  const { error } = await sb.rpc('platform_update_org', {
    p_org: s(fd, 'id'), p_legal_name: s(fd, 'legal_name'), p_tax_id: s(fd, 'tax_id'), p_contact_email: s(fd, 'contact_email'),
    p_contact_phone: s(fd, 'contact_phone'), p_notes: s(fd, 'notes'), p_unlimited: fd.get('unlimited') === 'on',
    p_max_employees: num(fd, 'max_employees'), p_paid_until: until(fd), p_max_stores: num(fd, 'max_stores'), p_max_devices: num(fd, 'max_devices'), p_features: features,
  });
  back('/platform', fd, error, 'Organización actualizada');
}

export async function setStatus(fd: FormData) {
  const sb = await supabaseServer();
  const { error } = await sb.rpc('platform_set_status', { p_org: s(fd, 'id'), p_status: s(fd, 'status'), p_reason: s(fd, 'reason') });
  back('/platform', fd, error, s(fd, 'status') === 'suspended' ? 'Organización suspendida' : 'Organización reactivada');
}

export async function createOwnOrg(fd: FormData) {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc('platform_create_own_org', { p_name: s(fd, 'name'), p_country: s(fd, 'country') });
  if (!error && data) fd.set('org', String(data));
  back('/platform', fd, error, 'Su organización fue creada (sin límite). Ya puede administrarla desde el menú.');
}

export type CreateOrgState = { status: 'idle' | 'ok' | 'error'; message?: string; link?: string | null };

/** Alta de una organización cliente por el dueño de la plataforma y, opcionalmente, invitación de su administrador principal. */
export async function createOrg(_prev: CreateOrgState, fd: FormData): Promise<CreateOrgState> {
  const sb = await supabaseServer();
  const unlimited = fd.get('unlimited') === 'on';
  const { data: orgId, error } = await sb.rpc('platform_create_org', {
    p_name: s(fd, 'name'), p_country: s(fd, 'country'), p_timezone: s(fd, 'timezone'), p_max_employees: num(fd, 'max_employees'),
    p_unlimited: unlimited, p_paid_until: until(fd), p_legal_name: s(fd, 'legal_name'), p_tax_id: s(fd, 'tax_id'),
    p_contact_email: s(fd, 'contact_email'), p_contact_phone: s(fd, 'contact_phone'),
  });
  if (error || !orgId) return { status: 'error', message: error?.message ?? 'No se pudo crear la organización' };
  const ms = num(fd, 'max_stores'), md = num(fd, 'max_devices');
  if (ms || md) {
    const r = await sb.rpc('platform_update_org', { p_org: orgId, p_legal_name: s(fd, 'legal_name'), p_tax_id: s(fd, 'tax_id'), p_contact_email: s(fd, 'contact_email'),
      p_contact_phone: s(fd, 'contact_phone'), p_notes: null, p_unlimited: unlimited, p_max_employees: num(fd, 'max_employees'), p_paid_until: until(fd),
      p_max_stores: ms, p_max_devices: md, p_features: {} });
    if (r.error) return { status: 'error', message: `Organización creada, pero no se guardaron los límites: ${r.error.message}` };
  }
  revalidatePath('/platform');
  const email = s(fd, 'admin_email');
  if (!email) return { status: 'ok', message: 'Organización creada. Puede invitar a su administrador más tarde desde aquí o desde Administradores.' };
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const inv = await sb.functions.invoke('admin-invite', {
    body: { email: email.toLowerCase(), name: s(fd, 'admin_name'), role: 'central_admin', organizationId: orgId, redirectTo: `https://${host}/auth/accept` },
  });
  if (inv.error) {
    let msg = 'No se pudo crear la invitación.';
    try { const j = await (inv.error as { context?: Response }).context?.json(); if (j?.error) msg = j.error; } catch { /* sin detalle */ }
    return { status: 'error', message: `Organización creada, pero la invitación falló: ${msg}` };
  }
  const r = inv.data as { existing: boolean; link: string | null };
  return { status: 'ok', link: r.link, message: r.existing ? 'Organización creada. La persona ya tenía cuenta: se le asignó como administrador central.'
    : 'Organización creada. Envíe este enlace al administrador principal (un solo uso, vence en ~24 horas).' };
}
