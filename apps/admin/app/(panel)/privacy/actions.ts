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
