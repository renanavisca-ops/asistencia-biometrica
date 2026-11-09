'use server';
import { supabaseServer } from '@/lib/supabase/server';
import { back, s } from '@/lib/actions';

export async function createRequest(fd: FormData) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  const { error } = await sb.from('retention_requests').insert({
    organization_id: s(fd, 'org'), employee_id: s(fd, 'employee_id'), kind: s(fd, 'kind'), reason: s(fd, 'reason'), requested_by: user?.id,
  });
  back('/privacy', fd, error, 'Solicitud registrada. Debe aprobarla otra persona con permiso de privacidad.');
}

export async function decide(fd: FormData) {
  const sb = await supabaseServer();
  const { error } = await sb.rpc('decide_retention_request', { p_id: s(fd, 'id'), p_approve: s(fd, 'approve') === 'true', p_notes: s(fd, 'notes') ?? '' });
  back('/privacy', fd, error, 'Solicitud decidida');
}

export async function grantSupport(fd: FormData) {
  const sb = await supabaseServer();
  const { error } = await sb.rpc('grant_support_access', { p_org: s(fd, 'org'), p_hours: Number(s(fd, 'hours') ?? 24), p_reason: s(fd, 'reason') });
  back('/privacy', fd, error, 'Acceso de soporte concedido (solo lectura, temporal)');
}
export async function revokeSupport(fd: FormData) {
  const sb = await supabaseServer();
  const { error } = await sb.rpc('revoke_support_access', { p_org: s(fd, 'org') });
  back('/privacy', fd, error, 'Acceso de soporte retirado');
}
export async function requestDeletion(fd: FormData) {
  const sb = await supabaseServer();
  const { error } = await sb.rpc('request_org_deletion', { p_org: s(fd, 'org'), p_confirm_name: s(fd, 'confirm') ?? '' });
  back('/privacy', fd, error, 'Eliminación programada. Sus datos se conservarán 90 días por si desea volver; después se borrarán definitivamente.');
}
export async function cancelDeletion(fd: FormData) {
  const sb = await supabaseServer();
  const { error } = await sb.rpc('cancel_org_deletion', { p_org: s(fd, 'org') });
  back('/privacy', fd, error, 'Eliminación cancelada');
}
