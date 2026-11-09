'use server';
import { supabaseServer } from '@/lib/supabase/server';
import { back, s } from '@/lib/actions';
import { humanError } from '@/lib/context';

export async function createDevice(fd: FormData) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  const { error } = await sb.from('devices').insert({ organization_id: s(fd, 'org'), store_id: s(fd, 'store_id'), label: s(fd, 'label'), created_by: user?.id });
  back('/devices', fd, error, 'Teléfono registrado. Emita un código de activación para vincularlo.');
}

export async function setDeviceStatus(fd: FormData) {
  const sb = await supabaseServer();
  const { error } = await sb.rpc('set_device_status', { p_device_id: s(fd, 'id'), p_status: s(fd, 'status'), p_reason: s(fd, 'reason') ?? '' });
  back('/devices', fd, error, 'Estado del teléfono actualizado');
}

/** Devuelve el código en la respuesta (nunca en la URL ni en logs). Solo se muestra una vez. */
export async function issueCode(_prev: { code?: string; error?: string } | null, fd: FormData) {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc('issue_device_activation_code', { p_device_id: s(fd, 'id'), p_ttl_minutes: 30 });
  return error ? { error: humanError(error) } : { code: data as string };
}

/** Permiso de enrolamiento del teléfono (revocable: al quitarlo, el servidor invalida al instante las sesiones de enrolamiento). */
export async function setCanEnroll(fd: FormData) {
  const sb = await supabaseServer();
  const allowed = s(fd, 'allowed') === '1';
  const { error } = await sb.rpc('set_device_can_enroll', { p_device_id: s(fd, 'id'), p_allowed: allowed });
  back('/devices', fd, error, allowed ? 'Permiso de enrolamiento activado (el teléfono lo verá al sincronizar)' : 'Permiso de enrolamiento retirado');
}
