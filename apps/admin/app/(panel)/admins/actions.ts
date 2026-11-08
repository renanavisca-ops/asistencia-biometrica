'use server';
import { supabaseServer } from '@/lib/supabase/server';
import { back, s } from '@/lib/actions';

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
