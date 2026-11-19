-- Tarea diaria de personal (06:20 UTC):
--  * aplica las bajas programadas cuya fecha ya llegó;
--  * borra plantillas biométricas revocadas por baja hace más de 30 días;
--  * recalcula tardanzas / «sin marcación» de los últimos 2 días (las ausencias solo se registran 12 h después de la
--    entrada programada, y sin marcaciones no hay otra ocasión que dispare el recálculo).
create or replace function private.daily_hr_maintenance() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_term int; v_purged int; v_emp int := 0; r record;
begin
  v_term := private.apply_scheduled_terminations();
  v_purged := private.purge_revoked_templates();
  for r in select e.id from public.employees e join public.organizations o on o.id = e.organization_id
           where e.status <> 'terminated' and o.status = 'active' loop
    perform private.recompute_day_flags(r.id, current_date - 2, current_date);
    v_emp := v_emp + 1;
  end loop;
  return jsonb_build_object('terminations', v_term, 'templates_purged', v_purged, 'employees_recomputed', v_emp);
end $$;
revoke execute on function private.daily_hr_maintenance() from public;

do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('hr-daily-maintenance', '20 6 * * *', 'select private.daily_hr_maintenance()');
  end if;
end $$;
