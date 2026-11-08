'use server';
import { supabaseServer } from '@/lib/supabase/server';
import { back, s } from '@/lib/actions';

export async function resolveIncident(fd: FormData) {
  const sb = await supabaseServer();
  const { error } = await sb.rpc('resolve_incident', { p_incident_id: s(fd, 'id'), p_status: s(fd, 'status'), p_resolution: s(fd, 'resolution') ?? '' });
  back('/incidents', fd, error, 'Incidencia cerrada');
}

/** Corrección auditada: nunca modifica el evento original. */
export async function correct(fd: FormData) {
  const sb = await supabaseServer();
  const kind = s(fd, 'kind');
  const at = s(fd, 'occurred_at');
  const { error } = await sb.rpc('correct_attendance', {
    p_kind: kind, p_employee_id: s(fd, 'employee_id'), p_reason: s(fd, 'reason') ?? '',
    p_target_event_id: s(fd, 'target_event_id'), p_event_type: s(fd, 'event_type'),
    p_occurred_at: at ? new Date(at).toISOString() : null, p_store_id: s(fd, 'store_id'), p_incident_id: s(fd, 'incident_id'),
  });
  back('/incidents', fd, error, 'Corrección registrada y auditada');
}
