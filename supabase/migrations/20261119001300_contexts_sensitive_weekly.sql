-- =====================================================================================
-- 2026-11-19 (b)
--  1. Motivos de baja protegidos: solo administración central de la organización o personas con permiso expreso
--     («hr.sensitive»). Los supervisores y auditores ven el tipo de salida y las fechas, nunca el motivo.
--  2. Permisos adicionales por persona (administrados por la organización).
--  3. Plataforma: planes comerciales configurables, indicadores de crecimiento (solo agregados) y registro auditado de
--     cada ingreso de soporte.
--  4. Horarios semanales por sucursal importados desde Excel.
-- =====================================================================================

-- ---------- 1–2. Datos sensibles de las bajas ----------
insert into public.role_permissions (role, permission) values ('central_admin', 'hr.sensitive') on conflict do nothing;

create table if not exists public.admin_permission_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.admins(user_id),
  organization_id uuid not null references public.organizations(id),
  permission text not null check (permission in ('hr.sensitive')),
  granted_by uuid not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid
);
create unique index if not exists admin_permission_grants_active on public.admin_permission_grants (user_id, organization_id, permission) where revoked_at is null;
alter table public.admin_permission_grants enable row level security;
create policy apg_select on public.admin_permission_grants for select to authenticated
  using (user_id = auth.uid() or private.has_org_perm('admin.manage', organization_id));

-- ¿Puede ver los motivos de la baja de este empleado? (nunca por acceso de soporte)
create or replace function private.can_see_termination(p_employee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.employees e where e.id = p_employee and (
    private.has_org_perm('hr.sensitive', e.organization_id)
    or (private.admin_session_ok()
        and exists (select 1 from public.admin_permission_grants g where g.user_id = auth.uid() and g.organization_id = e.organization_id
                    and g.permission = 'hr.sensitive' and g.revoked_at is null)
        and private.can_see_employee('hr.read', p_employee))));
$$;

create or replace function public.grant_extra_permission(p_user uuid, p_org uuid, p_permission text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.is_org_admin(p_org) then raise exception 'permiso denegado' using errcode = '42501'; end if;
  if p_permission <> 'hr.sensitive' then raise exception 'Permiso no válido'; end if;
  if not exists (select 1 from public.admin_role_grants g where g.user_id = p_user and g.organization_id = p_org and g.role <> 'superadmin' and g.revoked_at is null) then
    raise exception 'La persona no tiene un rol en esta organización';
  end if;
  insert into public.admin_permission_grants (user_id, organization_id, permission, granted_by) values (p_user, p_org, p_permission, auth.uid())
  on conflict do nothing returning id into v_id;
  return v_id;
end $$;
create or replace function public.revoke_extra_permission(p_grant uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare g public.admin_permission_grants%rowtype;
begin
  select * into g from public.admin_permission_grants where id = p_grant for update;
  if not found or not private.is_org_admin(g.organization_id) then raise exception 'permiso denegado' using errcode = '42501'; end if;
  update public.admin_permission_grants set revoked_at = now(), revoked_by = auth.uid() where id = p_grant and revoked_at is null;
end $$;

-- Columnas de motivo ocultas en la tabla; se leen con termination_details (controla el permiso).
revoke select on public.employment_periods from authenticated;
grant select (id, organization_id, employee_id, period_no, started_on, ended_on, end_type, end_recorded_by, end_recorded_at,
              started_recorded_by, created_at) on public.employment_periods to authenticated;

create or replace function public.termination_details(p_employee uuid)
returns table (period_id uuid, cause text, reason text, comments text, notes text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_see_termination(p_employee) then return; end if;
  return query select p.id, c.label, p.end_reason, p.end_comments, p.end_notes
    from public.employment_periods p left join public.hr_catalog c on c.id = p.end_cause_id
   where p.employee_id = p_employee and p.ended_on is not null order by p.period_no desc;
end $$;

-- El historial de estado ya no expone motivos (la baja registra un texto genérico; el motivo vive en el período).
revoke select on public.employee_status_history from authenticated;
grant select (id, organization_id, employee_id, from_status, to_status, changed_by, changed_at) on public.employee_status_history to authenticated;

create or replace function private.apply_termination(p_employee uuid, p_effective date, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_end timestamptz;
begin
  perform set_config('app.reason', 'baja laboral (detalle en el expediente)', true);
  update public.employees set status = 'terminated', terminated_on = p_effective where id = p_employee and status <> 'terminated';
  v_end := greatest((p_effective + 1)::timestamp at time zone 'UTC', now());
  update public.employee_store_assignments set valid_to = greatest(valid_from + interval '1 second', v_end)
   where employee_id = p_employee and revoked_at is null and (valid_to is null or valid_to > v_end);
  update public.biometric_enrollments set status = 'revoked', revoked_at = now(), revoked_reason = 'baja laboral'
   where employee_id = p_employee and status = 'active';
  update private.biometric_template_versions set revoked_at = now() where employee_id = p_employee and revoked_at is null;
end $$;

-- Eventos laborales de baja: solo el tipo (el motivo queda en el período). Se limpian los ya registrados.
create or replace function public.terminate_employee(
  p_employee_id uuid, p_end_type text, p_effective_on date, p_reason text, p_comments text, p_notes text, p_cause_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_emp public.employees%rowtype; v_p public.employment_periods%rowtype;
begin
  select * into v_emp from public.employees where id = p_employee_id for update;
  if not found or not private.has_org_perm('employee.manage', v_emp.organization_id) then raise exception 'permiso denegado' using errcode = '42501'; end if;
  if v_emp.status = 'terminated' then raise exception 'El empleado ya está dado de baja'; end if;
  if p_end_type not in ('resignation', 'dismissal', 'contract_end', 'mutual_agreement', 'other') then raise exception 'Tipo de salida no válido'; end if;
  if p_effective_on is null then raise exception 'Indique la fecha efectiva de salida'; end if;
  if length(coalesce(trim(p_reason), '')) < 5 then raise exception 'Escriba el motivo específico de la salida'; end if;
  if p_cause_id is not null and not exists (select 1 from public.hr_catalog where id = p_cause_id and organization_id = v_emp.organization_id and kind = 'termination_cause') then
    raise exception 'Causa no válida'; end if;
  select * into v_p from public.employment_periods where employee_id = p_employee_id and ended_on is null for update;
  if not found then raise exception 'El empleado no tiene un período de contratación abierto'; end if;
  if p_effective_on < v_p.started_on then raise exception 'La fecha de salida no puede ser anterior al ingreso (%)', v_p.started_on; end if;
  update public.employment_periods set ended_on = p_effective_on, end_type = p_end_type, end_cause_id = p_cause_id,
    end_reason = trim(p_reason), end_comments = nullif(trim(p_comments), ''), end_notes = nullif(trim(p_notes), ''),
    end_recorded_by = auth.uid(), end_recorded_at = now() where id = v_p.id;
  insert into public.employment_events (organization_id, employee_id, period_id, kind, effective_on, details, recorded_by)
  values (v_emp.organization_id, p_employee_id, v_p.id, case when p_effective_on > current_date then 'termination_scheduled' else 'termination' end,
          p_effective_on, jsonb_build_object('end_type', p_end_type), auth.uid());
  if p_effective_on <= current_date then perform private.apply_termination(p_employee_id, p_effective_on, p_reason); end if;
  return v_p.id;
end $$;
alter table public.employment_events disable trigger trg_append_only;
update public.employment_events set details = details - 'reason' where kind in ('termination', 'termination_scheduled') and details ? 'reason';
alter table public.employment_events enable trigger trg_append_only;

-- Auditoría: los registros de períodos laborales y documentos de salida solo para quien puede ver los motivos.
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated using (
  (organization_id is not null and private.has_org_perm('audit.read', organization_id)
    and (entity <> 'employment_periods' or private.can_see_termination((coalesce(after, before) ->> 'employee_id')::uuid))
    and (entity <> 'hr_documents' or coalesce(after, before) ->> 'related_type' <> 'termination'
         or private.can_see_termination((coalesce(after, before) ->> 'employee_id')::uuid)))
  or (organization_id is null and private.is_superadmin()));

-- Documentos de salida: mismo criterio (tabla y archivos).
drop policy if exists hr_documents_select on public.hr_documents;
create policy hr_documents_select on public.hr_documents for select to authenticated
  using (private.has_org_perm('hr.read', organization_id) and (related_type <> 'termination' or private.can_see_termination(employee_id)));
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute 'drop policy if exists hr_docs_read on storage.objects';
    execute $p$create policy hr_docs_read on storage.objects for select to authenticated
      using (bucket_id = 'hr-documents' and private.has_org_perm('hr.read', ((storage.foldername(name))[1])::uuid)
             and not exists (select 1 from public.hr_documents d where d.storage_path = name and d.related_type = 'termination'
                             and not private.can_see_termination(d.employee_id)))$p$;
  end if;
end $$;

-- ---------- 3. Plataforma ----------
create table if not exists public.platform_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_-]{2,30}$'),
  name text not null,
  max_employees int check (max_employees is null or max_employees >= 1),
  max_stores int check (max_stores is null or max_stores >= 1),
  max_devices int check (max_devices is null or max_devices >= 1),
  features jsonb not null default '{}',
  price_note text,
  active boolean not null default true,
  sort int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.platform_plans enable row level security;
create policy plans_select on public.platform_plans for select to authenticated using (private.is_superadmin());
alter table public.organizations add column if not exists plan_id uuid references public.platform_plans(id);
insert into public.platform_plans (code, name, max_employees, sort) values
  ('gratis', 'Gratis (1–5)', 5, 10), ('p10', 'Hasta 10', 10, 20), ('p20', 'Hasta 20', 20, 30), ('p30', 'Hasta 30', 30, 40),
  ('p50', 'Hasta 50', 50, 50), ('p100', 'Hasta 100', 100, 60), ('ilimitado', 'Sin límite', null, 99)
on conflict (code) do nothing;

create or replace function public.platform_save_plan(p_id uuid, p_code text, p_name text, p_max_employees int, p_max_stores int, p_max_devices int,
  p_features jsonb, p_price_note text, p_active boolean, p_sort int) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.is_superadmin() then raise exception 'permiso denegado' using errcode = '42501'; end if;
  if p_id is null then
    insert into public.platform_plans (code, name, max_employees, max_stores, max_devices, features, price_note, active, sort)
    values (lower(trim(p_code)), trim(p_name), p_max_employees, p_max_stores, p_max_devices, coalesce(p_features, '{}'), nullif(trim(p_price_note), ''), coalesce(p_active, true), coalesce(p_sort, 100))
    returning id into v_id;
  else
    update public.platform_plans set code = lower(trim(p_code)), name = trim(p_name), max_employees = p_max_employees, max_stores = p_max_stores,
      max_devices = p_max_devices, features = coalesce(p_features, '{}'), price_note = nullif(trim(p_price_note), ''), active = coalesce(p_active, true),
      sort = coalesce(p_sort, 100), updated_at = now() where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Plan inexistente'; end if;
  end if;
  insert into public.audit_log (organization_id, actor, actor_kind, action, entity, entity_id, after)
  values (null, auth.uid(), 'admin', 'platform_save_plan', 'platform_plans', v_id::text,
          jsonb_build_object('code', p_code, 'name', p_name, 'max_employees', p_max_employees, 'max_stores', p_max_stores, 'max_devices', p_max_devices, 'active', p_active));
  return v_id;
end $$;

-- Aplica un plan: copia sus límites y módulos a la organización (después pueden ajustarse a mano).
create or replace function public.platform_apply_plan(p_org uuid, p_plan uuid, p_paid_until timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare pl public.platform_plans%rowtype;
begin
  if not private.is_superadmin() then raise exception 'permiso denegado' using errcode = '42501'; end if;
  select * into pl from public.platform_plans where id = p_plan;
  if not found then raise exception 'Plan inexistente'; end if;
  update public.organizations set plan_id = pl.id, unlimited = pl.max_employees is null,
    paid_max_employees = case when pl.max_employees is null or pl.max_employees = 5 then null else pl.max_employees end,
    paid_until = case when pl.max_employees is null or pl.max_employees = 5 then null else p_paid_until end,
    max_stores = pl.max_stores, max_devices = pl.max_devices, features = pl.features
   where id = p_org;
  if not found then raise exception 'Organización inexistente'; end if;
  insert into public.audit_log (organization_id, actor, actor_kind, action, entity, entity_id, after)
  values (null, auth.uid(), 'admin', 'platform_apply_plan', 'organizations', p_org::text, jsonb_build_object('plan', pl.code, 'paid_until', p_paid_until));
end $$;

-- Indicadores globales: solo agregados (sin nombres de empleados, expedientes ni biometría).
create or replace function public.platform_growth(p_months int default 12) returns table (
  month text, new_orgs int, total_orgs int, active_orgs int, employees int, punches int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_superadmin() then raise exception 'permiso denegado' using errcode = '42501'; end if;
  return query
  with m as (select generate_series(date_trunc('month', now()) - make_interval(months => least(greatest(p_months, 1), 36) - 1), date_trunc('month', now()), interval '1 month') as s)
  select to_char(m.s, 'YYYY-MM'),
    (select count(*)::int from public.organizations o where o.created_at >= m.s and o.created_at < m.s + interval '1 month'),
    (select count(*)::int from public.organizations o where o.created_at < m.s + interval '1 month'),
    (select count(distinct a.organization_id)::int from public.attendance_events a where a.received_at >= m.s and a.received_at < m.s + interval '1 month'),
    (select count(*)::int from public.employment_periods p where p.started_on < (m.s + interval '1 month')::date
        and (p.ended_on is null or p.ended_on >= (m.s + interval '1 month')::date - 1)),
    (select count(*)::int from public.attendance_events a where a.received_at >= m.s and a.received_at < m.s + interval '1 month')
  from m order by 1;
end $$;

-- Cada ingreso del superadministrador a una organización con acceso de soporte queda en la auditoría de ESA
-- organización (visible para sus administradores). Como máximo un registro cada 30 minutos por persona.
create or replace function public.record_support_view(p_org uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.support_active(p_org) then return; end if;
  if exists (select 1 from public.audit_log where organization_id = p_org and actor = auth.uid() and action = 'support_view' and at > now() - interval '30 minutes') then return; end if;
  insert into public.audit_log (organization_id, actor, actor_kind, action, entity, entity_id, after)
  values (p_org, auth.uid(), 'admin', 'support_view', 'organizations', p_org::text, jsonb_build_object('path', left(p_path, 200)));
end $$;

-- ---------- 4. Horarios semanales por sucursal (importación desde Excel) ----------
alter table public.work_schedules add column if not exists source text not null default 'manual' check (source in ('manual', 'weekly_import'));
alter table public.work_schedules add column if not exists store_id uuid references public.stores(id);
alter table public.work_schedules add column if not exists week_start date;

-- p_rows: [{"code": "R01", "days": {"1": {"start": "08:00", "end": "16:00"}, ...}}]; día sin hora = descanso.
-- Reemplaza la importación anterior de la misma sucursal y semana. Todo o nada.
create or replace function public.import_weekly_schedule(p_store uuid, p_week_start date, p_tolerance int, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.stores%rowtype; r jsonb; v_emp uuid; v_pattern jsonb; v_sched uuid; v_patterns jsonb := '{}'; v_unknown text[] := '{}';
        v_n int := 0; v_k int := 0; d int; v_start time; v_end time; v_key text; v_emps uuid[] := '{}';
begin
  select * into s from public.stores where id = p_store;
  if not found or not private.has_org_perm('schedule.manage', s.organization_id) or not private.feature_on(s.organization_id, 'schedules') then
    raise exception 'permiso denegado' using errcode = '42501'; end if;
  if p_week_start is null or extract(isodow from p_week_start) <> 1 then raise exception 'La semana debe iniciar un lunes'; end if;
  if p_tolerance is null or p_tolerance not between 0 and 240 then raise exception 'Tolerancia no válida (0 a 240 minutos)'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'El archivo no tiene empleados'; end if;
  if jsonb_array_length(p_rows) > 500 then raise exception 'Máximo 500 empleados por archivo'; end if;
  -- Validación previa: códigos existentes y vigentes en la organización.
  for r in select value from jsonb_array_elements(p_rows) loop
    if not exists (select 1 from public.employees e where e.organization_id = s.organization_id and e.employee_code = r ->> 'code' and e.status <> 'terminated') then
      v_unknown := v_unknown || (r ->> 'code');
    end if;
  end loop;
  if array_length(v_unknown, 1) > 0 then
    raise exception 'Códigos de empleado no encontrados o dados de baja: %', array_to_string(v_unknown, ', ');
  end if;
  v_key := 'semana:' || p_store || ':' || p_week_start;
  -- Reemplazo de la importación anterior de esa semana.
  delete from public.schedule_assignments where note = v_key;
  delete from public.work_schedules ws where ws.source = 'weekly_import' and ws.store_id = p_store and ws.week_start = p_week_start
    and not exists (select 1 from public.schedule_assignments a where a.schedule_id = ws.id);
  for r in select value from jsonb_array_elements(p_rows) loop
    select e.id into v_emp from public.employees e where e.organization_id = s.organization_id and e.employee_code = r ->> 'code';
    v_pattern := coalesce(r -> 'days', '{}');
    v_sched := (v_patterns ->> v_pattern::text)::uuid;
    if v_sched is null then
      v_k := v_k + 1;
      insert into public.work_schedules (organization_id, name, tolerance_minutes, source, store_id, week_start, created_by)
      values (s.organization_id, 'Semana ' || p_week_start || ' · ' || s.code || ' · ' || v_k, p_tolerance, 'weekly_import', p_store, p_week_start, auth.uid())
      returning id into v_sched;
      for d in 1..7 loop
        v_start := nullif(v_pattern -> d::text ->> 'start', '')::time;
        v_end := nullif(v_pattern -> d::text ->> 'end', '')::time;
        if v_start is not null then
          insert into public.work_schedule_days (organization_id, schedule_id, weekday, start_time, end_time) values (s.organization_id, v_sched, d, v_start, v_end);
        end if;
      end loop;
      v_patterns := v_patterns || jsonb_build_object(v_pattern::text, v_sched);
    end if;
    insert into public.schedule_assignments (organization_id, schedule_id, employee_id, valid_from, valid_to, note, created_by)
    values (s.organization_id, v_sched, v_emp, p_week_start, p_week_start + 6, v_key, auth.uid());
    v_emps := v_emps || v_emp; v_n := v_n + 1;
  end loop;
  -- Semana pasada o en curso: recalcular tardanzas y alertas de esos empleados.
  if p_week_start <= current_date then
    foreach v_emp in array v_emps loop
      perform private.recompute_day_flags(v_emp, p_week_start, least(p_week_start + 6, current_date));
    end loop;
  end if;
  insert into public.audit_log (organization_id, actor, actor_kind, action, entity, entity_id, after)
  values (s.organization_id, auth.uid(), 'admin', 'import_weekly_schedule', 'stores', p_store::text,
          jsonb_build_object('week_start', p_week_start, 'employees', v_n, 'schedules', v_k, 'tolerance', p_tolerance));
  return jsonb_build_object('employees', v_n, 'schedules', v_k);
end $$;

-- Vista de la semana de una sucursal: hora de entrada/salida efectiva por empleado y día (con su origen).
create or replace function public.store_week_schedule(p_store uuid, p_week_start date)
returns table (employee_id uuid, employee_code text, first_name text, last_name text, weekday int, work_date date,
               start_time time, end_time time, kind text, schedule_name text)
language plpgsql stable security definer set search_path = '' as $$
declare s public.stores%rowtype;
begin
  select * into s from public.stores where id = p_store;
  if not found or not private.has_store_perm('attendance.read', p_store) then raise exception 'permiso denegado' using errcode = '42501'; end if;
  return query
  with emps as (
    select distinct e.id, e.employee_code, e.first_name, e.last_name from public.employees e
      join public.employee_store_assignments a on a.employee_id = e.id and a.store_id = p_store and a.revoked_at is null
     where e.status <> 'terminated' and a.valid_from < (p_week_start + 7)::timestamp at time zone 'UTC'
       and (a.valid_to is null or a.valid_to > p_week_start::timestamp at time zone 'UTC')),
  days as (select g::int as wd, p_week_start + g - 1 as dt from generate_series(1, 7) g)
  select e.id, e.employee_code, e.first_name, e.last_name, d.wd, d.dt,
    case when x.o_start_at is null then null else (x.o_start_at at time zone coalesce(x.o_tz, s.timezone))::time end,
    (select wd2.end_time from public.work_schedule_days wd2 where wd2.schedule_id = x.o_schedule_id and wd2.weekday = d.wd),
    case when x.o_no_check then 'exception' when x.o_start_at is null then 'none' else 'scheduled' end,
    (select ws.name from public.work_schedules ws where ws.id = x.o_schedule_id)
  from emps e cross join days d cross join lateral private.expected_start(e.id, d.dt) x
  order by e.last_name, e.first_name, d.wd;
end $$;

-- ---------- Permisos y auditoría ----------
do $$ begin
  execute 'drop trigger if exists trg_audit on public.admin_permission_grants';
  execute 'create trigger trg_audit after insert or update or delete on public.admin_permission_grants for each row execute function private.audit()';
  execute 'drop trigger if exists trg_audit on public.platform_plans';
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant select on public.admin_permission_grants, public.platform_plans to authenticated';
    execute 'grant execute on function public.grant_extra_permission(uuid, uuid, text), public.revoke_extra_permission(uuid),
      public.termination_details(uuid), public.platform_save_plan(uuid, text, text, int, int, int, jsonb, text, boolean, int),
      public.platform_apply_plan(uuid, uuid, timestamptz), public.platform_growth(int), public.record_support_view(uuid, text),
      public.import_weekly_schedule(uuid, date, int, jsonb), public.store_week_schedule(uuid, date) to authenticated';
    execute 'grant execute on function private.can_see_termination(uuid) to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.admin_permission_grants, public.platform_plans to service_role';
    execute 'grant select on public.employment_periods, public.employee_status_history to service_role';
    execute 'grant execute on all functions in schema private to service_role';
  end if;
end $$;
revoke execute on function public.grant_extra_permission(uuid, uuid, text), public.revoke_extra_permission(uuid), public.termination_details(uuid),
  public.platform_save_plan(uuid, text, text, int, int, int, jsonb, text, boolean, int), public.platform_apply_plan(uuid, uuid, timestamptz),
  public.platform_growth(int), public.record_support_view(uuid, text), public.import_weekly_schedule(uuid, date, int, jsonb),
  public.store_week_schedule(uuid, date) from public, anon;

-- purge_org: tablas nuevas.
create or replace function private.purge_org_extra(p_org uuid) returns void language sql security definer set search_path = '' as $$
  delete from public.admin_permission_grants where organization_id = p_org;
$$;
do $$ declare v text; begin
  select pg_get_functiondef('private.purge_org(uuid)'::regprocedure) into v;
  if position('purge_org_extra' in v) = 0 then
    v := replace(v, '-- Módulos de personal (ampliación 2026-11-19).', '-- Módulos de personal (ampliación 2026-11-19).' || chr(10) || '  perform private.purge_org_extra(p_org);');
    execute v;
  end if;
end $$;

notify pgrst, 'reload schema';
