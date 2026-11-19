-- La vía antigua de cambio de estado (set_employee_status) pasa por el ciclo laboral, para que ninguna baja quede sin
-- período cerrado ni historial: «terminated» = baja de tipo «otra causa» con fecha de hoy; suspensión y reintegro dejan
-- su evento laboral.
create or replace function public.set_employee_status(p_employee_id uuid, p_status public.employee_status, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_emp public.employees%rowtype;
begin
  select * into v_emp from public.employees where id = p_employee_id;
  if not found or not private.has_org_perm('employee.manage', v_emp.organization_id) then raise exception 'permiso denegado' using errcode = '42501'; end if;
  if length(coalesce(trim(p_reason), '')) < 5 then raise exception 'motivo requerido'; end if;
  if p_status = v_emp.status then return; end if;
  if p_status = 'terminated' then
    perform public.terminate_employee(p_employee_id, 'other', current_date, p_reason, null, null, null);
  elsif p_status = 'suspended' then
    perform public.suspend_employee(p_employee_id, current_date, null, p_reason);
  elsif v_emp.status = 'suspended' then
    perform public.reinstate_employee(p_employee_id, p_reason);
  else
    raise exception 'Para reincorporar a un empleado dado de baja use «Recontratar» (abre un nuevo período laboral)';
  end if;
end $$;
