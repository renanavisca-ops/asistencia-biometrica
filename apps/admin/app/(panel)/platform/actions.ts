'use server';
import { supabaseServer } from '@/lib/supabase/server';
import { back, s } from '@/lib/actions';

export async function setPlan(fd: FormData) {
  const sb = await supabaseServer();
  const tier = s(fd, 'tier');
  const until = s(fd, 'paid_until');
  const unlimited = tier === 'unlimited';
  const paidMax = unlimited || !tier || tier === '5' ? null : Number(tier);
  const { error } = await sb.rpc('platform_set_plan', {
    p_org: s(fd, 'id'), p_unlimited: unlimited, p_paid_max: paidMax,
    p_paid_until: paidMax ? (until ? new Date(until + 'T23:59:59').toISOString() : null) : null,
  });
  back('/platform', fd, error, 'Plan actualizado');
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
