'use server';
import { supabaseServer } from '@/lib/supabase/server';
import { back, s } from '@/lib/actions';

const P = '/schedules';

/** Crea o actualiza un horario de referencia con sus entradas por día. Los días sin hora quedan sin control. */
export async function saveSchedule(fd: FormData) {
  const sb = await supabaseServer();
  const org = s(fd, 'org')!;
  let id = s(fd, 'schedule_id');
  const name = s(fd, 'name'), tol = Number(s(fd, 'tolerance') ?? 5);
  if (id) {
    const { error } = await sb.from('work_schedules').update({ name, tolerance_minutes: tol, active: fd.get('active') !== 'off' }).eq('id', id);
    if (error) back(P, fd, error, '');
  } else {
    const { data, error } = await sb.from('work_schedules').insert({ organization_id: org, name, tolerance_minutes: tol }).select('id').single();
    if (error || !data) back(P, fd, error ?? { message: 'No se pudo crear' }, '');
    id = data.id as string;
  }
  const { error: delErr } = await sb.from('work_schedule_days').delete().eq('schedule_id', id);
  if (delErr) back(P, fd, delErr, '');
  const days = [1, 2, 3, 4, 5, 6, 7].flatMap((d) => {
    const st = s(fd, `start_${d}`);
    return st ? [{ organization_id: org, schedule_id: id, weekday: d, start_time: st, end_time: s(fd, `end_${d}`) }] : [];
  });
  if (days.length) {
    const { error } = await sb.from('work_schedule_days').insert(days);
    if (error) back(P, fd, error, '');
  }
  back(P, fd, null, 'Horario guardado. Use «Recalcular» para aplicar a fechas pasadas.');
}

export async function assign(fd: FormData) {
  const sb = await supabaseServer();
  const target = s(fd, 'target') ?? '';
  const { error } = await sb.from('schedule_assignments').insert({
    organization_id: s(fd, 'org'), schedule_id: s(fd, 'schedule_id'),
    employee_id: target.startsWith('e:') ? target.slice(2) : null, store_id: target.startsWith('s:') ? target.slice(2) : null,
    valid_from: s(fd, 'valid_from'), valid_to: s(fd, 'valid_to'), note: s(fd, 'note'),
  });
  back(P, fd, error, 'Horario asignado');
}

export async function endAssignment(fd: FormData) {
  const sb = await supabaseServer();
  const { error } = await sb.from('schedule_assignments').update({ valid_to: s(fd, 'valid_to') }).eq('id', s(fd, 'assignment_id'));
  back(P, fd, error, 'Vigencia actualizada');
}

export async function addException(fd: FormData) {
  const sb = await supabaseServer();
  const target = s(fd, 'target') ?? '';
  const { error } = await sb.from('schedule_exceptions').insert({
    organization_id: s(fd, 'org'), on_date: s(fd, 'on_date'), kind: s(fd, 'kind'), start_time: s(fd, 'start_time'), reason: s(fd, 'reason'),
    employee_id: target.startsWith('e:') ? target.slice(2) : null, store_id: target.startsWith('s:') ? target.slice(2) : null,
  });
  back(P, fd, error, 'Excepción registrada');
}

export async function deleteException(fd: FormData) {
  const sb = await supabaseServer();
  const { error } = await sb.from('schedule_exceptions').delete().eq('id', s(fd, 'exception_id'));
  back(P, fd, error, 'Excepción eliminada');
}

export async function recompute(fd: FormData) {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc('recompute_tardiness', { p_org: s(fd, 'org'), p_from: s(fd, 'from') });
  back(P, fd, error, `Recalculado para ${data ?? 0} empleados`);
}
