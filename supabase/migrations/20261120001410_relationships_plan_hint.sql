-- Relaciones que faltaban: el panel consulta alertas y tardanzas junto con la tienda y el empleado (PostgREST necesita
-- la clave foránea para unirlas). Sin ellas la lista de alertas, el reporte de puntualidad y la puntualidad del
-- expediente devolvían error. Detectado por la prueba de navegador del panel.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'alerts_store_fk') then
    alter table public.alerts add constraint alerts_store_fk foreign key (store_id) references public.stores(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'day_flags_store_fk') then
    alter table public.attendance_day_flags add constraint day_flags_store_fk foreign key (store_id) references public.stores(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'day_flags_employee_fk') then
    alter table public.attendance_day_flags add constraint day_flags_employee_fk foreign key (employee_id, organization_id) references public.employees(id, organization_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'day_flags_schedule_fk') then
    alter table public.attendance_day_flags add constraint day_flags_schedule_fk foreign key (schedule_id) references public.work_schedules(id) on delete set null;
  end if;
end $$;

-- Aviso del plan: el siguiente tramo sugerido nunca es el gratuito (límites personalizados menores a 5).
create or replace function public.org_plan_status(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare o public.organizations%rowtype; v_lim int; v_n int; v_warn text[] := '{}';
begin
  if not private.is_org_member(p_org) then raise exception 'permiso denegado' using errcode = '42501'; end if;
  select * into o from public.organizations where id = p_org;
  v_lim := private.employee_limit(p_org); v_n := private.current_employee_count(p_org);
  if o.status = 'suspended' then v_warn := v_warn || 'suspended'::text; end if;
  if o.status = 'pending_deletion' then v_warn := v_warn || 'pending_deletion'::text; end if;
  if not o.unlimited and o.paid_max_employees is not null and o.paid_until is not null then
    if o.paid_until < now() then v_warn := v_warn || 'expired'::text;
    elsif o.paid_until < now() + interval '7 days' then v_warn := v_warn || 'expiring_soon'::text; end if;
  end if;
  if v_lim is not null and v_n >= v_lim then v_warn := v_warn || 'at_limit'::text;
  elsif v_lim is not null and v_n >= ceil(v_lim * 0.8) then v_warn := v_warn || 'near_limit'::text; end if;
  return jsonb_build_object('status', o.status, 'access', private.org_access(p_org), 'unlimited', o.unlimited,
    'limit', v_lim, 'enrolled', v_n, 'employees', v_n, 'enrolledFaces', private.enrolled_count(p_org),
    'planLabel', case when o.unlimited then 'Sin límite' when o.paid_max_employees is null then 'Gratis (1–5 empleados)' else 'Hasta ' || o.paid_max_employees || ' empleados' end,
    'nextPlanLabel', case when v_lim is null then null else private.tier_label(private.tier_max(greatest(v_lim + 1, 6))) end,
    'paidUntil', o.paid_until, 'suspendedReason', o.suspended_reason, 'deletionDueAt', o.deletion_due_at,
    'supportUntil', (select max(expires_at) from public.support_access where organization_id = p_org and revoked_at is null and expires_at > now()),
    'features', o.features, 'warnings', to_jsonb(v_warn));
end $$;

notify pgrst, 'reload schema';
