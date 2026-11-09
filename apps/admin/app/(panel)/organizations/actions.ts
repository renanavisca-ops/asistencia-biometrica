'use server';
import { supabaseServer } from '@/lib/supabase/server';
import { back, s } from '@/lib/actions';

export async function createRegion(fd: FormData) {
  const sb = await supabaseServer();
  const { error } = await sb.from('regions').insert({
    organization_id: s(fd, 'org'), country_code: s(fd, 'country_code')?.toUpperCase(), name: s(fd, 'name'), timezone: s(fd, 'timezone'),
  });
  back('/organizations', fd, error, 'Región creada');
}

export async function createStore(fd: FormData) {
  const sb = await supabaseServer();
  const { data: region } = await sb.from('regions').select('timezone').eq('id', s(fd, 'region_id') ?? '').maybeSingle();
  const { error } = await sb.from('stores').insert({
    organization_id: s(fd, 'org'), region_id: s(fd, 'region_id'), code: s(fd, 'code'), name: s(fd, 'name'),
    timezone: s(fd, 'timezone') ?? region?.timezone, address: s(fd, 'address'), is_central: fd.get('is_central') === 'on',
  });
  back('/organizations', fd, error, 'Sede creada');
}

export async function setStoreStatus(fd: FormData) {
  const sb = await supabaseServer();
  const { error } = await sb.from('stores').update({ status: s(fd, 'status') }).eq('id', s(fd, 'id') ?? '');
  back('/organizations', fd, error, 'Estado de la sede actualizado');
}

export async function setPrefix(fd: FormData) {
  const sb = await supabaseServer();
  const { error } = await sb.from('organizations').update({ employee_code_prefix: (s(fd, 'prefix') ?? '').toUpperCase() }).eq('id', s(fd, 'org') ?? '');
  back('/organizations', fd, error, 'Prefijo actualizado (aplica a los próximos empleados)');
}
