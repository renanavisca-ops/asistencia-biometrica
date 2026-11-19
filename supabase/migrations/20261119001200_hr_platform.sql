-- =====================================================================================
-- Ampliación administrativa (2026-11-19):
--  Fase 2  Administración global: alta de organizaciones desde la plataforma, datos generales, límites
--          (empleados vigentes, sucursales, teléfonos), módulos por organización.
--  Fase 3  Ciclo laboral: períodos de contratación, bajas (renuncia, despido, fin de contrato, mutuo acuerdo,
--          otra causa), suspensiones, recontratación. Nada se borra.
--  Fase 4  Expediente: medidas disciplinarias y reconocimientos con seguimiento, documentos de respaldo.
--  Fase 5  Puntualidad: horarios de referencia OPCIONALES (por empleado o sucursal, por día, tolerancia,
--          excepciones y cambios temporales) y cálculo de tardanzas.
--  Fase 6  Alertas: 3 o más tardanzas en el mes calendario (configurable), sin duplicados, con seguimiento.
-- Principios: datos de cada organización aislados por RLS; el superadministrador no ve expedientes (ni siquiera con
-- acceso de soporte); registros disciplinarios y laborales sin borrado (anulación justificada y auditada).
-- =====================================================================================

-- ---------- Permisos nuevos ----------
insert into public.role_permissions (role, permission)
select 'central_admin'::public.role_code, p from unnest(array['hr.read','hr.manage','discipline.manage','discipline.record',
  'schedule.manage','alert.read','alert.manage','report.run']) p
union all
select 'supervisor'::public.role_code, p from unnest(array['hr.read','discipline.record','alert.read','alert.manage']) p
union all
select 'auditor'::public.role_code, p from unnest(array['hr.read','alert.read','report.run']) p
on conflict do nothing;

-- Permisos de lectura (válidos aunque la organización esté en solo lectura) y los que alcanza el acceso de soporte
-- (sin expedientes ni reportes de personal: datos sensibles).
create or replace function private.read_perms() returns text[] language sql immutable set search_path = '' as $$
  select array['store.read','employee.read','device.read','attendance.read','incident.read','audit.read','export.run',
               'hr.read','alert.read','report.run'];
$$;
create or replace function private.support_perms() returns text[] language sql immutable set search_path = '' as $$
  select array['store.read','employee.read','device.read','attendance.read','incident.read','audit.read','export.run','alert.read'];
$$;

create or replace function private.has_org_perm(p_perm text, p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.admin_session_ok() and (
    (exists (select 1 from public.admin_role_grants g join public.role_permissions rp on rp.role = g.role and rp.permission = p_perm
             where g.user_id = auth.uid() and g.revoked_at is null and g.role <> 'superadmin'
               and g.organization_id = p_org and g.store_id is null and g.region_id is null)
     and (p_perm = any(private.read_perms()) or private.org_access(p_org) = 'full'))
    or (p_perm = any(private.support_perms()) and private.support_active(p_org)));
$$;

create or replace function private.has_store_perm(p_perm text, p_store uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.admin_session_ok() and exists (select 1 from public.stores s where s.id = p_store and (
    (exists (select 1 from public.admin_role_grants g join public.role_permissions rp on rp.role = g.role and rp.permission = p_perm
             where g.user_id = auth.uid() and g.revoked_at is null and g.role <> 'superadmin' and g.organization_id = s.organization_id
               and ((g.store_id is null and g.region_id is null) or g.store_id = s.id or (g.store_id is null and g.region_id = s.region_id)))
     and (p_perm = any(private.read_perms()) or private.org_access(s.organization_id) = 'full'))
    or (p_perm = any(private.support_perms()) and private.support_active(s.organization_id))));
$$;

create or replace function private.store_ids_with(p_perm text) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select s.id from public.stores s
  where private.admin_session_ok() and (
    (exists (select 1 from public.admin_role_grants g join public.role_permissions rp on rp.role = g.role and rp.permission = p_perm
             where g.user_id = auth.uid() and g.revoked_at is null and g.role <> 'superadmin' and g.organization_id = s.organization_id
               and ((g.store_id is null and g.region_id is null) or g.store_id = s.id or (g.store_id is null and g.region_id = s.region_id)))
     and (p_perm = any(private.read_perms()) or private.org_access(s.organization_id) = 'full'))
    or (p_perm = any(private.support_perms()) and private.support_active(s.organization_id)));
$$;

-- ---------- Fase 2: organizaciones (datos generales, límites, módulos) ----------
alter table public.organizations
  add column if not exists legal_name text,
  add column if not exists tax_id text,
  add column if not exists contact_email text,
  add column if not exists contact_phone text,
  add column if not exists platform_notes text,
  add column if not exists max_stores int check (max_stores is null or max_stores >= 1),
  add column if not exists max_devices int check (max_devices is null or max_devices >= 1),
  add column if not exists features jsonb not null default '{}'::jsonb;
-- El límite de empleados puede ser cualquier cantidad (los tramos son sugerencias del panel).
alter table public.organizations drop constraint if exists organizations_paid_max_employees_check;
alter table public.organizations add constraint organizations_paid_max_employees_check check (paid_max_employees is null or paid_max_employees >= 1);
comment on column public.organizations.features is 'Módulos deshabilitados por plan: {"hr": false, "schedules": false, "alerts": false, "reports": false}. Ausente = habilitado.';

create or replace function private.feature_on(p_org uuid, p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select (o.features ->> p_key)::boolean from public.organizations o where o.id = p_org), true);
$$;

-- Cupo de empleados: cuentan los VIGENTES (activos o suspendidos temporalmente); los dados de baja no consumen cupo.
create or replace function private.employee_limit(p_org uuid) returns int
language sql stable security definer set search_path = '' as $$
  select case when o.unlimited then null else coalesce(o.paid_max_employees, 5) end from public.organizations o where o.id = p_org;
$$;
create or replace function private.current_employee_count(p_org uuid, p_except uuid default null) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.employees e where e.organization_id = p_org and e.status <> 'terminated'
     and (p_except is null or e.id <> p_except);
$$;
-- Avisos del plan: ahora sobre empleados vigentes (la clave 'enrolled' se mantiene por compatibilidad del panel).
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
    'nextPlanLabel', case when v_lim is null then null else private.tier_label(private.tier_max(v_lim + 1)) end,
    'paidUntil', o.paid_until, 'suspendedReason', o.suspended_reason, 'deletionDueAt', o.deletion_due_at,
    'supportUntil', (select max(expires_at) from public.support_access where organization_id = p_org and revoked_at is null and expires_at > now()),
    'features', o.features, 'warnings', to_jsonb(v_warn));
end $$;

-- El límite de enrolamiento sigue al mismo cupo.
create or replace function private.enroll_limit(p_org uuid) returns int
language sql stable security definer set search_path = '' as $$ select private.employee_limit(p_org); $$;

-- Validación en el servidor (aplica a cualquier vía: panel, RPC o inserción directa).
create or replace function private.enforce_employee_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_lim int; v_n int;
begin
  if new.status = 'terminated' then return new; end if;
  if tg_op = 'UPDATE' and old.status <> 'terminated' then return new; end if;
  v_lim := private.employee_limit(new.organization_id);
  if v_lim is null then return new; end if;
  v_n := private.current_employee_count(new.organization_id, new.id);
  if v_n >= v_lim then
    raise exception 'Límite del plan: la organización ya tiene % empleados vigentes (su plan permite %). Dé de baja a alguien o amplíe el plan.', v_n, v_lim
      using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_employee_limit on public.employees;
create trigger trg_employee_limit before insert or update of status on public.employees
  for each row execute function private.enforce_employee_limit();

create or replace function private.enforce_store_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_lim int;
begin
  select max_stores into v_lim from public.organizations where id = new.organization_id;
  if v_lim is not null and (select count(*) from public.stores where organization_id = new.organization_id and status = 'active') >= v_lim then
    raise exception 'Límite del plan: máximo % sucursales activas.', v_lim using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_store_limit on public.stores;
create trigger trg_store_limit before insert on public.stores for each row execute function private.enforce_store_limit();

create or replace function private.enforce_device_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_lim int;
begin
  select max_devices into v_lim from public.organizations where id = new.organization_id;
  if v_lim is not null and (select count(*) from public.devices where organization_id = new.organization_id and status <> 'retired') >= v_lim then
    raise exception 'Límite del plan: máximo % teléfonos.', v_lim using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_device_limit on public.devices;
create trigger trg_device_limit before insert on public.devices for each row execute function private.enforce_device_limit();

-- Alta de organización por el dueño de la plataforma (además del registro desde la app).
create or replace function public.platform_create_org(
  p_name text, p_country text, p_timezone text, p_max_employees int, p_unlimited boolean, p_paid_until timestamptz,
  p_legal_name text, p_tax_id text, p_contact_email text, p_contact_phone text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  if not private.is_superadmin() then raise exception 'permiso denegado' using errcode = '42501'; end if;
  v_org := private.create_org(p_name, upper(p_country), 'platform', coalesce(p_unlimited, false), null);
  update public.organizations set legal_name = nullif(trim(p_legal_name), ''), tax_id = nullif(trim(p_tax_id), ''),
    contact_email = nullif(lower(trim(p_contact_email)), ''), contact_phone = nullif(trim(p_contact_phone), ''),
    paid_max_employees = case when coalesce(p_unlimited, false) or p_max_employees is null or p_max_employees = 5 then null else p_max_employees end,
    paid_until = case when coalesce(p_unlimited, false) then null else p_paid_until end
   where id = v_org;
  if nullif(trim(p_timezone), '') is not null then
    if not exists (select 1 from pg_timezone_names where name = trim(p_timezone)) then raise exception 'Zona horaria no válida'; end if;
    update public.regions set timezone = trim(p_timezone) where organization_id = v_org;
  end if;
  insert into public.audit_log (organization_id, actor, actor_kind, action, entity, entity_id) values (null, auth.uid(), 'admin', 'platform_create_org', 'organizations', v_org::text);
  return v_org;
end $$;

create or replace function public.platform_update_org(
  p_org uuid, p_legal_name text, p_tax_id text, p_contact_email text, p_contact_phone text, p_notes text,
  p_unlimited boolean, p_max_employees int, p_paid_until timestamptz, p_max_stores int, p_max_devices int, p_features jsonb
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_superadmin() then raise exception 'permiso denegado' using errcode = '42501'; end if;
  update public.organizations set legal_name = nullif(trim(p_legal_name), ''), tax_id = nullif(trim(p_tax_id), ''),
    contact_email = nullif(lower(trim(p_contact_email)), ''), contact_phone = nullif(trim(p_contact_phone), ''), platform_notes = nullif(trim(p_notes), ''),
    unlimited = coalesce(p_unlimited, false),
    paid_max_employees = case when coalesce(p_unlimited, false) or p_max_employees is null or p_max_employees = 5 then null else p_max_employees end,
    paid_until = case when coalesce(p_unlimited, false) or p_max_employees is null or p_max_employees = 5 then null else p_paid_until end,
    max_stores = p_max_stores, max_devices = p_max_devices, features = coalesce(p_features, '{}'::jsonb)
   where id = p_org;
  if not found then raise exception 'organización inexistente'; end if;
  insert into public.audit_log (organization_id, actor, actor_kind, action, entity, entity_id, after)
  values (null, auth.uid(), 'admin', 'platform_update_org', 'organizations', p_org::text,
          jsonb_build_object('unlimited', p_unlimited, 'max_employees', p_max_employees, 'paid_until', p_paid_until,
                             'max_stores', p_max_stores, 'max_devices', p_max_devices, 'features', p_features));
end $$;

drop function if exists public.platform_orgs();
create function public.platform_orgs() returns table (
  id uuid, name text, legal_name text, tax_id text, contact_email text, contact_phone text, platform_notes text,
  country_code char(2), timezone text, status text, access text, created_at timestamptz, created_via text,
  employees_active int, employees_enrolled int, stores int, devices_active int, punches_30d int, last_activity timestamptz,
  unlimited boolean, max_employees int, paid_until timestamptz, max_stores int, max_devices int, features jsonb,
  needed_tier_label text, plan_label text, over_limit boolean,
  admin_contacts text, support_until timestamptz, deletion_due_at timestamptz, suspended_reason text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_superadmin() then raise exception 'permiso denegado' using errcode = '42501'; end if;
  return query
  select o.id, o.name, o.legal_name, o.tax_id, o.contact_email, o.contact_phone, o.platform_notes,
    o.country_code, (select r.timezone from public.regions r where r.organization_id = o.id order by r.created_at limit 1),
    o.status, private.org_access(o.id), o.created_at, o.created_via,
    private.current_employee_count(o.id), private.enrolled_count(o.id),
    (select count(*)::int from public.stores s where s.organization_id = o.id and s.status = 'active'),
    (select count(*)::int from public.devices d where d.organization_id = o.id and d.status = 'active'),
    (select count(*)::int from public.attendance_events a where a.organization_id = o.id and a.received_at > now() - interval '30 days'),
    (select max(d.last_seen_at) from public.devices d where d.organization_id = o.id),
    o.unlimited, private.employee_limit(o.id), o.paid_until, o.max_stores, o.max_devices, o.features,
    private.tier_label(private.tier_max(greatest(private.current_employee_count(o.id), 1))),
    case when o.unlimited then 'Sin límite' when o.paid_max_employees is null then 'Gratis (1–5 empleados)' else 'Hasta ' || o.paid_max_employees || ' empleados' end,
    (not o.unlimited and private.current_employee_count(o.id) > coalesce(o.paid_max_employees, 5)),
    (select string_agg(a.display_name || ' <' || a.email || '>', ', ') from public.admin_role_grants g join public.admins a on a.user_id = g.user_id
      where g.organization_id = o.id and g.role = 'central_admin' and g.revoked_at is null),
    (select max(s.expires_at) from public.support_access s where s.organization_id = o.id and s.revoked_at is null and s.expires_at > now()),
    o.deletion_due_at, o.suspended_reason
  from public.organizations o order by o.created_at;
end $$;

-- El dueño de la plataforma puede asignar el administrador principal de cualquier organización (sin volverse
-- administrador de ella: no puede invitarse a sí mismo ni a otra cuenta de superadministrador).
create or replace function public.can_invite_admin(p_org uuid, p_role public.role_code) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when p_role = 'superadmin' then private.is_superadmin()
              else private.has_org_perm('admin.manage', p_org) or (p_role = 'central_admin' and private.is_superadmin()) end;
$$;
create or replace function private.register_invited_admin(p_user_id uuid, p_name text, p_email text, p_role public.role_code, p_org uuid, p_invited_by uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if length(coalesce(trim(p_name), '')) < 2 then raise exception 'nombre requerido'; end if;
  -- Separación de contextos: una cuenta de superadministrador solo entra a una organización si un administrador de
  -- ESA organización la invita (o es la organización propia creada con platform_create_own_org).
  if p_role <> 'superadmin' and exists (select 1 from public.admin_role_grants g where g.user_id = p_user_id and g.role = 'superadmin' and g.revoked_at is null)
     and not exists (select 1 from public.admin_role_grants g where g.user_id = p_invited_by and g.role = 'central_admin'
                     and g.organization_id = p_org and g.revoked_at is null) then
    raise exception 'Una cuenta de superadministrador no puede asignarse a una organización desde la plataforma';
  end if;
  insert into public.admins (user_id, display_name, email) values (p_user_id, trim(p_name), lower(trim(p_email)))
  on conflict (user_id) do update set display_name = excluded.display_name;
  if exists (select 1 from public.admin_role_grants where user_id = p_user_id and role = p_role
             and organization_id is not distinct from (case when p_role = 'superadmin' then null else p_org end) and revoked_at is null) then
    return null;
  end if;
  insert into public.admin_role_grants (user_id, role, organization_id, granted_by)
  values (p_user_id, p_role, case when p_role = 'superadmin' then null else p_org end, p_invited_by) returning id into v_id;
  insert into public.audit_log (organization_id, actor, actor_kind, action, entity, entity_id, after)
  values (p_org, p_invited_by, 'admin', 'invite_admin', 'admins', p_user_id::text, jsonb_build_object('email', lower(trim(p_email)), 'role', p_role));
  return v_id;
end $$;

-- ---------- Catálogos configurables por organización ----------
create table if not exists public.hr_catalog (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  kind text not null check (kind in ('termination_cause', 'discipline_category')),
  label text not null check (length(trim(label)) between 2 and 120),
  active boolean not null default true,
  sort int not null default 100,
  created_at timestamptz not null default now(),
  unique (organization_id, kind, label)
);
create or replace function private.seed_org_hr_defaults(p_org uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.hr_catalog (organization_id, kind, label, sort)
  select p_org, 'discipline_category', l, s from (values
    ('Incumplimiento de procedimientos', 10), ('Problemas de puntualidad', 20), ('Ausencias injustificadas (verificadas)', 30),
    ('Incumplimiento de normas internas', 40), ('Otros incidentes', 90)) v(l, s)
  on conflict do nothing;
$$;
create or replace function private.org_hr_defaults_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$ begin perform private.seed_org_hr_defaults(new.id); return new; end $$;
drop trigger if exists trg_org_hr_defaults on public.organizations;
create trigger trg_org_hr_defaults after insert on public.organizations for each row execute function private.org_hr_defaults_trigger();
select private.seed_org_hr_defaults(id) from public.organizations;

-- ---------- Fase 3: períodos de contratación y eventos laborales ----------
create table if not exists public.employment_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null,
  period_no int not null,
  started_on date not null,
  ended_on date,
  end_type text check (end_type in ('resignation', 'dismissal', 'contract_end', 'mutual_agreement', 'other')),
  end_cause_id uuid references public.hr_catalog(id),
  end_reason text,
  end_comments text,
  end_notes text,
  end_recorded_by uuid,
  end_recorded_at timestamptz,
  started_recorded_by uuid,
  created_at timestamptz not null default now(),
  foreign key (employee_id, organization_id) references public.employees(id, organization_id),
  unique (employee_id, period_no),
  check (ended_on is null or ended_on >= started_on),
  check ((ended_on is null) = (end_type is null))
);
create unique index if not exists employment_periods_one_open on public.employment_periods (employee_id) where ended_on is null;
create index if not exists employment_periods_org on public.employment_periods (organization_id, ended_on);

create table if not exists public.employment_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  employee_id uuid not null,
  period_id uuid references public.employment_periods(id),
  kind text not null check (kind in ('hire', 'rehire', 'termination', 'termination_scheduled', 'suspension', 'reinstatement', 'note')),
  effective_on date not null,
  details jsonb not null default '{}',
  recorded_by uuid,
  recorded_at timestamptz not null default now(),
  foreign key (employee_id, organization_id) references public.employees(id, organization_id)
);
create index if not exists employment_events_emp on public.employment_events (employee_id, effective_on);

-- Primer período para los empleados existentes (fecha de ingreso registrada o fecha de alta en el sistema).
insert into public.employment_periods (organization_id, employee_id, period_no, started_on, ended_on, end_type, end_reason, end_recorded_at)
select e.organization_id, e.id, 1, coalesce(e.hired_on, e.created_at::date),
       case when e.status = 'terminated' then greatest(coalesce(e.terminated_on, current_date), coalesce(e.hired_on, e.created_at::date)) end,
       case when e.status = 'terminated' then 'other' end,
       case when e.status = 'terminated' then 'Baja registrada antes del módulo de ciclo laboral' end,
       case when e.status = 'terminated' then now() end
from public.employees e where not exists (select 1 from public.employment_periods p where p.employee_id = e.id);

-- Todo empleado nuevo abre su período 1.
create or replace function private.employee_first_period() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.employment_periods (organization_id, employee_id, period_no, started_on, started_recorded_by)
  values (new.organization_id, new.id, 1, coalesce(new.hired_on, current_date), new.created_by);
  insert into public.employment_events (organization_id, employee_id, kind, effective_on, recorded_by)
  values (new.organization_id, new.id, 'hire', coalesce(new.hired_on, current_date), new.created_by);
  return new;
end $$;
drop trigger if exists trg_employee_first_period on public.employees;
create trigger trg_employee_first_period after insert on public.employees for each row execute function private.employee_first_period();

-- Efectos de una baja ya vigente: inactivo, fin de asignaciones, enrolamiento revocado (plantillas retenidas 30 días y
-- luego borradas por la tarea diaria). El historial (asistencia, expediente, disciplina) se conserva completo.
create or replace function private.apply_termination(p_employee uuid, p_effective date, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_end timestamptz;
begin
  perform set_config('app.reason', left(p_reason, 200), true);
  update public.employees set status = 'terminated', terminated_on = p_effective where id = p_employee and status <> 'terminated';
  v_end := greatest((p_effective + 1)::timestamp at time zone 'UTC', now());
  update public.employee_store_assignments set valid_to = greatest(valid_from + interval '1 second', v_end)
   where employee_id = p_employee and revoked_at is null and (valid_to is null or valid_to > v_end);
  update public.biometric_enrollments set status = 'revoked', revoked_at = now(), revoked_reason = 'baja laboral'
   where employee_id = p_employee and status = 'active';
  update private.biometric_template_versions set revoked_at = now() where employee_id = p_employee and revoked_at is null;
end $$;

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
          p_effective_on, jsonb_build_object('end_type', p_end_type, 'reason', trim(p_reason)), auth.uid());
  -- Fecha futura: el empleado sigue activo hasta ese día (la tarea diaria aplica la baja).
  if p_effective_on <= current_date then perform private.apply_termination(p_employee_id, p_effective_on, p_reason); end if;
  return v_p.id;
end $$;

-- Bajas con fecha futura que ya vencieron (tarea diaria).
create or replace function private.apply_scheduled_terminations() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select p.employee_id, p.ended_on, p.end_reason from public.employment_periods p join public.employees e on e.id = p.employee_id
           where p.ended_on is not null and p.ended_on <= current_date and e.status <> 'terminated'
             and p.id = (select id from public.employment_periods x where x.employee_id = p.employee_id order by period_no desc limit 1) loop
    perform private.apply_termination(r.employee_id, r.ended_on, r.end_reason);
    insert into public.employment_events (organization_id, employee_id, kind, effective_on, details)
    select organization_id, id, 'termination', r.ended_on, jsonb_build_object('applied', 'programada') from public.employees where id = r.employee_id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Plantillas biométricas de enrolamientos revocados por baja: se borran a los 30 días (no indiscriminadamente al instante).
create or replace function private.purge_revoked_templates() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from private.biometric_template_versions where revoked_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.rehire_employee(p_employee_id uuid, p_started_on date, p_store_id uuid, p_notes text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_emp public.employees%rowtype; v_last public.employment_periods%rowtype; v_id uuid;
begin
  select * into v_emp from public.employees where id = p_employee_id for update;
  if not found or not private.has_org_perm('employee.manage', v_emp.organization_id) then raise exception 'permiso denegado' using errcode = '42501'; end if;
  if v_emp.status <> 'terminated' then raise exception 'Solo se puede recontratar a un empleado dado de baja'; end if;
  if p_started_on is null then raise exception 'Indique la fecha de reingreso'; end if;
  select * into v_last from public.employment_periods where employee_id = p_employee_id order by period_no desc limit 1;
  if v_last.ended_on is not null and p_started_on <= v_last.ended_on then raise exception 'El reingreso debe ser posterior a la última salida (%)', v_last.ended_on; end if;
  perform set_config('app.reason', 'recontratación', true);
  update public.employees set status = 'active', terminated_on = null, hired_on = p_started_on where id = p_employee_id; -- valida el cupo
  insert into public.employment_periods (organization_id, employee_id, period_no, started_on, started_recorded_by)
  values (v_emp.organization_id, p_employee_id, coalesce(v_last.period_no, 0) + 1, p_started_on, auth.uid()) returning id into v_id;
  insert into public.employment_events (organization_id, employee_id, period_id, kind, effective_on, details, recorded_by)
  values (v_emp.organization_id, p_employee_id, v_id, 'rehire', p_started_on, jsonb_build_object('notes', p_notes), auth.uid());
  if p_store_id is not null then
    insert into public.employee_store_assignments (organization_id, employee_id, store_id, kind, valid_from, reason, created_by)
    values (v_emp.organization_id, p_employee_id, p_store_id, 'permanent', greatest(p_started_on::timestamp at time zone 'UTC', now()), 'recontratación', auth.uid());
  end if;
  return v_id;
end $$;

create or replace function public.suspend_employee(p_employee_id uuid, p_from date, p_until date, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_emp public.employees%rowtype;
begin
  select * into v_emp from public.employees where id = p_employee_id for update;
  if not found or not private.has_org_perm('employee.manage', v_emp.organization_id) then raise exception 'permiso denegado' using errcode = '42501'; end if;
  if v_emp.status <> 'active' then raise exception 'Solo se puede suspender a un empleado activo'; end if;
  if length(coalesce(trim(p_reason), '')) < 5 then raise exception 'Escriba el motivo de la suspensión'; end if;
  if p_until is not null and p_until < coalesce(p_from, current_date) then raise exception 'Fechas no válidas'; end if;
  perform set_config('app.reason', p_reason, true);
  update public.employees set status = 'suspended' where id = p_employee_id;
  insert into public.employment_events (organization_id, employee_id, period_id, kind, effective_on, details, recorded_by)
  values (v_emp.organization_id, p_employee_id, (select id from public.employment_periods where employee_id = p_employee_id and ended_on is null),
          'suspension', coalesce(p_from, current_date), jsonb_build_object('until', p_until, 'reason', p_reason), auth.uid());
end $$;
create or replace function public.reinstate_employee(p_employee_id uuid, p_notes text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_emp public.employees%rowtype;
begin
  select * into v_emp from public.employees where id = p_employee_id for update;
  if not found or not private.has_org_perm('employee.manage', v_emp.organization_id) then raise exception 'permiso denegado' using errcode = '42501'; end if;
  if v_emp.status <> 'suspended' then raise exception 'El empleado no está suspendido'; end if;
  perform set_config('app.reason', coalesce(p_notes, 'fin de suspensión'), true);
  update public.employees set status = 'active' where id = p_employee_id;
  insert into public.employment_events (organization_id, employee_id, period_id, kind, effective_on, details, recorded_by)
  values (v_emp.organization_id, p_employee_id, (select id from public.employment_periods where employee_id = p_employee_id and ended_on is null),
          'reinstatement', current_date, jsonb_build_object('notes', p_notes), auth.uid());
end $$;

-- ---------- Fase 4: medidas disciplinarias, reconocimientos y documentos ----------
create table if not exists public.disciplinary_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null,
  period_id uuid references public.employment_periods(id),
  store_id uuid references public.stores(id),
  kind text not null default 'disciplinary' check (kind in ('disciplinary', 'recognition')),
  incident_date date not null,
  category_id uuid references public.hr_catalog(id),
  measure text check (measure in ('verbal', 'written', 'suspension', 'other')),
  description text not null check (length(trim(description)) >= 10),
  admin_comments text,
  employee_informed boolean not null default false,
  informed_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'in_review', 'communicated', 'resolved', 'closed', 'voided')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voided_by uuid, voided_at timestamptz, void_reason text,
  foreign key (employee_id, organization_id) references public.employees(id, organization_id),
  check (kind = 'recognition' or measure is not null)
);
create index if not exists disciplinary_emp on public.disciplinary_records (employee_id, incident_date);
create index if not exists disciplinary_org on public.disciplinary_records (organization_id, status, incident_date);

create table if not exists public.disciplinary_followups (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  record_id uuid not null references public.disciplinary_records(id),
  status_from text, status_to text,
  comment text not null check (length(trim(comment)) >= 3),
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists public.hr_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null,
  related_type text not null default 'general' check (related_type in ('general', 'termination', 'disciplinary', 'hire')),
  related_id uuid,
  doc_type text not null check (length(trim(doc_type)) >= 2),
  file_name text not null,
  storage_path text not null unique,
  size_bytes bigint,
  mime_type text,
  uploaded_by uuid not null,
  uploaded_at timestamptz not null default now(),
  voided_by uuid, voided_at timestamptz, void_reason text,
  foreign key (employee_id, organization_id) references public.employees(id, organization_id)
);

create or replace function private.can_record_discipline(p_employee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.employees e where e.id = p_employee and private.feature_on(e.organization_id, 'hr')
                 and (private.has_org_perm('discipline.manage', e.organization_id) or private.can_see_employee('discipline.record', p_employee)));
$$;

create or replace function public.create_disciplinary_record(
  p_employee_id uuid, p_kind text, p_incident_date date, p_category_id uuid, p_measure text, p_description text,
  p_admin_comments text, p_employee_informed boolean, p_store_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_emp public.employees%rowtype; v_id uuid;
begin
  select * into v_emp from public.employees where id = p_employee_id;
  if not found or not private.can_record_discipline(p_employee_id) then raise exception 'permiso denegado' using errcode = '42501'; end if;
  if p_incident_date is null or p_incident_date > current_date then raise exception 'Fecha del incidente no válida'; end if;
  if coalesce(p_kind, 'disciplinary') not in ('disciplinary', 'recognition') then raise exception 'Tipo no válido'; end if;
  if p_category_id is not null and not exists (select 1 from public.hr_catalog where id = p_category_id and organization_id = v_emp.organization_id and kind = 'discipline_category') then
    raise exception 'Categoría no válida'; end if;
  insert into public.disciplinary_records (organization_id, employee_id, period_id, store_id, kind, incident_date, category_id, measure, description,
    admin_comments, employee_informed, informed_at, status, created_by)
  values (v_emp.organization_id, p_employee_id,
          (select id from public.employment_periods where employee_id = p_employee_id and started_on <= p_incident_date
             and (ended_on is null or ended_on >= p_incident_date) order by period_no desc limit 1),
          p_store_id, coalesce(p_kind, 'disciplinary'), p_incident_date, p_category_id,
          case when coalesce(p_kind, 'disciplinary') = 'recognition' then null else p_measure end, trim(p_description),
          nullif(trim(p_admin_comments), ''), coalesce(p_employee_informed, false), case when p_employee_informed then now() end,
          case when coalesce(p_kind, 'disciplinary') = 'recognition' then 'closed' when p_employee_informed then 'communicated' else 'pending' end,
          auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.followup_disciplinary_record(p_record_id uuid, p_status text, p_comment text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.disciplinary_records%rowtype;
begin
  select * into r from public.disciplinary_records where id = p_record_id for update;
  if not found or not private.can_record_discipline(r.employee_id) then raise exception 'permiso denegado' using errcode = '42501'; end if;
  if r.status = 'voided' then raise exception 'El registro está anulado'; end if;
  if p_status is not null and p_status not in ('pending', 'in_review', 'communicated', 'resolved', 'closed') then raise exception 'Estado no válido'; end if;
  insert into public.disciplinary_followups (organization_id, record_id, status_from, status_to, comment, created_by)
  values (r.organization_id, r.id, r.status, coalesce(p_status, r.status), trim(p_comment), auth.uid());
  update public.disciplinary_records set status = coalesce(p_status, status), updated_at = now(),
    employee_informed = employee_informed or coalesce(p_status, '') = 'communicated',
    informed_at = case when informed_at is null and coalesce(p_status, '') = 'communicated' then now() else informed_at end
   where id = r.id;
end $$;

-- Anulación (nunca borrado): requiere motivo, solo administración central, queda en auditoría y seguimiento.
create or replace function public.void_disciplinary_record(p_record_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.disciplinary_records%rowtype;
begin
  select * into r from public.disciplinary_records where id = p_record_id for update;
  if not found or not private.has_org_perm('discipline.manage', r.organization_id) then raise exception 'permiso denegado' using errcode = '42501'; end if;
  if length(coalesce(trim(p_reason), '')) < 10 then raise exception 'Escriba el motivo de la anulación (mínimo 10 caracteres)'; end if;
  insert into public.disciplinary_followups (organization_id, record_id, status_from, status_to, comment, created_by)
  values (r.organization_id, r.id, r.status, 'voided', 'ANULADO: ' || trim(p_reason), auth.uid());
  update public.disciplinary_records set status = 'voided', voided_by = auth.uid(), voided_at = now(), void_reason = trim(p_reason), updated_at = now() where id = r.id;
end $$;

create or replace function public.register_hr_document(p_employee_id uuid, p_related_type text, p_related_id uuid, p_doc_type text,
  p_file_name text, p_storage_path text, p_size bigint, p_mime text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_emp public.employees%rowtype; v_id uuid;
begin
  select * into v_emp from public.employees where id = p_employee_id;
  if not found or not (private.has_org_perm('hr.manage', v_emp.organization_id) or private.has_org_perm('discipline.manage', v_emp.organization_id)) then
    raise exception 'permiso denegado' using errcode = '42501'; end if;
  if split_part(p_storage_path, '/', 1) <> v_emp.organization_id::text or split_part(p_storage_path, '/', 2) <> p_employee_id::text then
    raise exception 'Ruta de documento no válida'; end if;
  insert into public.hr_documents (organization_id, employee_id, related_type, related_id, doc_type, file_name, storage_path, size_bytes, mime_type, uploaded_by)
  values (v_emp.organization_id, p_employee_id, coalesce(p_related_type, 'general'), p_related_id, trim(p_doc_type), left(p_file_name, 200), p_storage_path, p_size, left(p_mime, 100), auth.uid())
  returning id into v_id;
  return v_id;
end $$;
create or replace function public.void_hr_document(p_document_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.hr_documents%rowtype;
begin
  select * into d from public.hr_documents where id = p_document_id for update;
  if not found or not private.has_org_perm('hr.manage', d.organization_id) then raise exception 'permiso denegado' using errcode = '42501'; end if;
  if length(coalesce(trim(p_reason), '')) < 5 then raise exception 'Motivo requerido'; end if;
  update public.hr_documents set voided_by = auth.uid(), voided_at = now(), void_reason = trim(p_reason) where id = d.id;
end $$;

-- ---------- Fase 5: horarios de referencia (opcionales) y tardanzas ----------
create table if not exists public.work_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null check (length(trim(name)) >= 2),
  tolerance_minutes int not null default 5 check (tolerance_minutes between 0 and 240),
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (id, organization_id)
);
create table if not exists public.work_schedule_days (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  schedule_id uuid not null,
  weekday int not null check (weekday between 1 and 7), -- ISO: 1 = lunes … 7 = domingo
  start_time time not null,
  end_time time, -- si es menor que la entrada, la jornada termina al día siguiente (turno nocturno)
  unique (schedule_id, weekday),
  foreign key (schedule_id, organization_id) references public.work_schedules(id, organization_id) on delete cascade
);
create table if not exists public.schedule_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  schedule_id uuid not null,
  employee_id uuid,
  store_id uuid references public.stores(id),
  valid_from date not null,
  valid_to date,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key (schedule_id, organization_id) references public.work_schedules(id, organization_id),
  check ((employee_id is null) <> (store_id is null)),
  check (valid_to is null or valid_to >= valid_from)
);
create index if not exists schedule_assignments_emp on public.schedule_assignments (employee_id, valid_from);
create index if not exists schedule_assignments_store on public.schedule_assignments (store_id, valid_from);
create table if not exists public.schedule_exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  employee_id uuid,
  store_id uuid references public.stores(id),
  on_date date not null,
  kind text not null check (kind in ('day_off', 'permit', 'custom')),
  start_time time,
  reason text not null check (length(trim(reason)) >= 3),
  created_by uuid,
  created_at timestamptz not null default now(),
  check ((employee_id is null) <> (store_id is null)),
  check (kind <> 'custom' or start_time is not null)
);
create index if not exists schedule_exceptions_lookup on public.schedule_exceptions (on_date, employee_id, store_id);

-- Resultado derivado (se recalcula): una fila por empleado y jornada con horario: tardanza o sin marcación.
create table if not exists public.attendance_day_flags (
  organization_id uuid not null,
  employee_id uuid not null,
  work_date date not null,
  kind text not null check (kind in ('late', 'no_show')),
  store_id uuid,
  scheduled_start timestamptz not null,
  tolerance_minutes int not null,
  first_in_at timestamptz,
  first_in_event_id uuid,
  minutes_late int,
  schedule_id uuid,
  computed_at timestamptz not null default now(),
  primary key (employee_id, work_date)
);
create index if not exists attendance_day_flags_org on public.attendance_day_flags (organization_id, work_date, kind);

-- Sucursal y zona horaria de referencia del empleado en una fecha.
create or replace function private.employee_store_on(p_employee uuid, p_date date) returns uuid
language sql stable security definer set search_path = '' as $$
  select a.store_id from public.employee_store_assignments a
   where a.employee_id = p_employee and a.revoked_at is null
     and a.valid_from < (p_date + 1)::timestamp at time zone 'UTC' and (a.valid_to is null or a.valid_to > p_date::timestamp at time zone 'UTC')
   order by (a.kind = 'temporary') desc, a.valid_from desc limit 1;
$$;

-- Entrada programada (o ninguna) para un empleado en una fecha. Prioridad: excepción del empleado > excepción de la
-- sucursal > horario del empleado > horario de la sucursal. Sin horario → null (no se clasifica tardanza).
create or replace function private.expected_start(p_employee uuid, p_date date,
  out o_store_id uuid, out o_tz text, out o_start_at timestamptz, out o_tolerance int, out o_schedule_id uuid, out o_no_check boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid; v_store uuid; v_tz text; v_exc_kind text; v_exc_start time; v_sched uuid; v_start time; v_tol int;
begin
  select e.organization_id into v_org from public.employees e where e.id = p_employee;
  v_store := private.employee_store_on(p_employee, p_date);
  select s.timezone into v_tz from public.stores s where s.id = v_store;
  if v_tz is null then select r.timezone into v_tz from public.regions r where r.organization_id = v_org order by r.created_at limit 1; end if;
  o_store_id := v_store; o_tz := v_tz; o_no_check := false;
  select se.kind, se.start_time into v_exc_kind, v_exc_start from public.schedule_exceptions se
   where se.on_date = p_date and (se.employee_id = p_employee or (se.employee_id is null and se.store_id = v_store))
   order by (se.employee_id is not null) desc, se.created_at desc limit 1;
  select sa.schedule_id into v_sched from public.schedule_assignments sa
   join public.work_schedules ws on ws.id = sa.schedule_id and ws.active
   where (sa.employee_id = p_employee or (sa.employee_id is null and sa.store_id = v_store))
     and sa.valid_from <= p_date and (sa.valid_to is null or sa.valid_to >= p_date)
   order by (sa.employee_id is not null) desc, sa.valid_from desc, sa.created_at desc limit 1;
  if v_sched is not null then
    select ws.tolerance_minutes into v_tol from public.work_schedules ws where ws.id = v_sched;
    select d.start_time into v_start from public.work_schedule_days d where d.schedule_id = v_sched and d.weekday = extract(isodow from p_date)::int;
  end if;
  if v_exc_kind in ('day_off', 'permit') then o_no_check := true; return; end if;
  if v_exc_kind = 'custom' then v_start := v_exc_start; end if;
  if v_start is null then return; end if;
  o_schedule_id := v_sched;
  o_tolerance := coalesce(v_tol, 5);
  o_start_at := (p_date + v_start) at time zone v_tz;
end $$;

-- Recalcula tardanzas y «sin marcación» de un empleado en un rango de fechas. Usa solo marcaciones vigentes aceptadas
-- (las correcciones anulan o confirman); una jornada cuenta una sola vez (primera entrada en la ventana del turno).
create or replace function private.recompute_day_flags(p_employee uuid, p_from date, p_to date) returns void
language plpgsql security definer set search_path = '' as $$
declare d date; v_org uuid; v_status public.employee_status; v_hire date; v_end date; x record; ev record; v_late int;
begin
  select e.organization_id, e.status into v_org, v_status from public.employees e where e.id = p_employee;
  if v_org is null then return; end if;
  delete from public.attendance_day_flags where employee_id = p_employee and work_date between p_from and p_to;
  d := p_from;
  while d <= p_to loop
    -- Solo dentro de un período de contratación.
    if exists (select 1 from public.employment_periods p where p.employee_id = p_employee and p.started_on <= d and (p.ended_on is null or p.ended_on >= d)) then
      select x0.o_store_id as store_id, x0.o_start_at as start_at, x0.o_tolerance as tolerance, x0.o_schedule_id as schedule_id,
             x0.o_no_check as no_check into x from private.expected_start(p_employee, d) x0;
      if x.start_at is not null and not x.no_check then
        select a.id, a.occurred_at into ev from public.attendance_events_effective a
         where a.employee_id = p_employee and a.event_type = 'IN' and a.effective_status = 'accepted'
           and a.occurred_at >= x.start_at - interval '4 hours' and a.occurred_at < x.start_at + interval '12 hours'
         order by a.occurred_at limit 1;
        if ev.id is not null then
          v_late := ceil(extract(epoch from (ev.occurred_at - x.start_at)) / 60.0)::int;
          if ev.occurred_at > x.start_at + make_interval(mins => x.tolerance) then
            insert into public.attendance_day_flags (organization_id, employee_id, work_date, kind, store_id, scheduled_start, tolerance_minutes,
              first_in_at, first_in_event_id, minutes_late, schedule_id)
            values (v_org, p_employee, d, 'late', x.store_id, x.start_at, x.tolerance, ev.occurred_at, ev.id, v_late, x.schedule_id);
          end if;
        elsif x.start_at + interval '12 hours' < now() then
          insert into public.attendance_day_flags (organization_id, employee_id, work_date, kind, store_id, scheduled_start, tolerance_minutes, schedule_id)
          values (v_org, p_employee, d, 'no_show', x.store_id, x.start_at, x.tolerance, x.schedule_id);
        end if;
        ev := null;
      end if;
    end if;
    d := d + 1;
  end loop;
  perform private.evaluate_tardiness_alerts(p_employee, date_trunc('month', p_from)::date, p_to);
end $$;

-- ---------- Fase 6: alertas ----------
create table if not exists public.alert_rules (
  organization_id uuid primary key references public.organizations(id),
  tardiness_enabled boolean not null default true,
  tardiness_threshold int not null default 3 check (tardiness_threshold between 1 and 31),
  tardiness_period text not null default 'calendar_month' check (tardiness_period in ('calendar_month')),
  notify_admin_ids uuid[] not null default '{}',
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  kind text not null check (kind in ('tardiness')),
  employee_id uuid not null,
  store_id uuid,
  period_key text not null, -- p. ej. 2026-11
  count int not null,
  threshold int not null,
  details jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'dismissed', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (employee_id, organization_id) references public.employees(id, organization_id),
  unique (organization_id, kind, employee_id, period_key)
);
create index if not exists alerts_org on public.alerts (organization_id, status, period_key);
create table if not exists public.alert_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  alert_id uuid not null references public.alerts(id),
  kind text not null check (kind in ('created', 'count_changed', 'comment', 'status')),
  from_value text, to_value text, comment text,
  actor uuid,
  created_at timestamptz not null default now()
);

create or replace function private.evaluate_tardiness_alerts(p_employee uuid, p_from date, p_to date) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; m date; v_n int; v_thr int; v_on boolean; a public.alerts%rowtype; v_key text; v_store uuid;
begin
  select organization_id into v_org from public.employees where id = p_employee;
  select coalesce(r.tardiness_enabled, true), coalesce(r.tardiness_threshold, 3) into v_on, v_thr
    from (select 1) z left join public.alert_rules r on r.organization_id = v_org;
  if not v_on or not private.feature_on(v_org, 'alerts') then return; end if;
  m := date_trunc('month', p_from)::date;
  while m <= p_to loop
    v_key := to_char(m, 'YYYY-MM');
    select count(*), (array_agg(store_id order by work_date desc))[1] into v_n, v_store from public.attendance_day_flags
     where employee_id = p_employee and kind = 'late' and work_date >= m and work_date < (m + interval '1 month')::date;
    select * into a from public.alerts where organization_id = v_org and kind = 'tardiness' and employee_id = p_employee and period_key = v_key for update;
    if a.id is null and v_n >= v_thr then
      insert into public.alerts (organization_id, kind, employee_id, store_id, period_key, count, threshold, details)
      values (v_org, 'tardiness', p_employee, v_store, v_key, v_n, v_thr, jsonb_build_object('message',
        'El empleado ha registrado ' || v_n || ' llegadas tarde durante el mes. Se recomienda revisar su historial de puntualidad.'))
      returning * into a;
      insert into public.alert_events (organization_id, alert_id, kind, to_value) values (v_org, a.id, 'created', v_n::text);
    elsif a.id is not null and a.count <> v_n then
      -- Misma alerta del período: se actualiza (3 → 4 …) o refleja una corrección; nunca se duplica ni se borra.
      update public.alerts set count = v_n, updated_at = now(),
        details = jsonb_build_object('message', case when v_n >= a.threshold
          then 'El empleado ha registrado ' || v_n || ' llegadas tarde durante el mes. Se recomienda revisar su historial de puntualidad.'
          else 'Tras correcciones, el empleado tiene ' || v_n || ' llegadas tarde en el mes (por debajo del umbral de ' || a.threshold || ').' end),
        status = case when status in ('reviewed', 'closed') and v_n > a.count then 'pending' else status end
       where id = a.id;
      insert into public.alert_events (organization_id, alert_id, kind, from_value, to_value) values (v_org, a.id, 'count_changed', a.count::text, v_n::text);
    end if;
    a := null;
    m := (m + interval '1 month')::date;
  end loop;
end $$;

create or replace function public.alert_followup(p_alert_id uuid, p_status text, p_comment text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.alerts%rowtype;
begin
  select * into a from public.alerts where id = p_alert_id for update;
  if not found or not (private.has_org_perm('alert.manage', a.organization_id) or private.can_see_employee('alert.manage', a.employee_id)) then
    raise exception 'permiso denegado' using errcode = '42501'; end if;
  if p_status is not null and p_status not in ('pending', 'reviewed', 'dismissed', 'closed') then raise exception 'Estado no válido'; end if;
  if p_status = 'dismissed' and length(coalesce(trim(p_comment), '')) < 10 then raise exception 'Para descartar una alerta escriba la justificación'; end if;
  if p_status is null and length(coalesce(trim(p_comment), '')) < 3 then raise exception 'Escriba un comentario'; end if;
  if p_status is not null and p_status <> a.status then
    update public.alerts set status = p_status, updated_at = now() where id = a.id;
    insert into public.alert_events (organization_id, alert_id, kind, from_value, to_value, comment, actor)
    values (a.organization_id, a.id, 'status', a.status, p_status, nullif(trim(p_comment), ''), auth.uid());
  else
    insert into public.alert_events (organization_id, alert_id, kind, comment, actor) values (a.organization_id, a.id, 'comment', trim(p_comment), auth.uid());
  end if;
end $$;

create or replace function public.set_alert_rules(p_org uuid, p_enabled boolean, p_threshold int, p_notify uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_org_perm('alert.manage', p_org) then raise exception 'permiso denegado' using errcode = '42501'; end if;
  insert into public.alert_rules (organization_id, tardiness_enabled, tardiness_threshold, notify_admin_ids, updated_by, updated_at)
  values (p_org, coalesce(p_enabled, true), coalesce(p_threshold, 3), coalesce(p_notify, '{}'), auth.uid(), now())
  on conflict (organization_id) do update set tardiness_enabled = excluded.tardiness_enabled, tardiness_threshold = excluded.tardiness_threshold,
    notify_admin_ids = excluded.notify_admin_ids, updated_by = excluded.updated_by, updated_at = now();
end $$;

-- Recalcular (tras cambiar horarios o reglas): empleados vigentes de la organización, desde una fecha.
create or replace function public.recompute_tardiness(p_org uuid, p_from date) returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  if not (private.has_org_perm('schedule.manage', p_org) or private.has_org_perm('alert.manage', p_org)) then raise exception 'permiso denegado' using errcode = '42501'; end if;
  if p_from < current_date - 400 then raise exception 'Rango demasiado amplio'; end if;
  for r in select id from public.employees where organization_id = p_org loop
    perform private.recompute_day_flags(r.id, p_from, current_date); n := n + 1;
  end loop;
  return n;
end $$;

-- Gancho: cada vez que se reconstruyen las sesiones de un empleado (ingesta de marcaciones, incluidas las offline que
-- llegan tarde, y correcciones) se recalculan sus tardanzas recientes y sus alertas.
do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'rebuild_sessions_core') then
    alter function private.rebuild_sessions(uuid) rename to rebuild_sessions_core;
  end if;
end $$;
create or replace function private.rebuild_sessions(p_employee uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.rebuild_sessions_core(p_employee);
  perform private.recompute_day_flags(p_employee, (date_trunc('month', current_date) - interval '1 month')::date, current_date);
end $$;

-- Borrado definitivo (90 días tras la eliminación) incluye los módulos nuevos. PENDIENTE: los archivos del bucket
-- hr-documents de la organización deben borrarse con la API de Storage (no desde SQL).
create or replace function private.purge_org(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_users uuid[];
begin
  perform set_config('app.retention_purge', 'on', true);
  select array_agg(distinct user_id) into v_users from public.admin_role_grants where organization_id = p_org;
  delete from private.enroll_tickets where device_id in (select id from public.devices where organization_id = p_org);
  -- Módulos de personal (ampliación 2026-11-19).
  delete from public.alert_events where organization_id = p_org;
  delete from public.alerts where organization_id = p_org;
  delete from public.alert_rules where organization_id = p_org;
  delete from public.attendance_day_flags where organization_id = p_org;
  delete from public.schedule_exceptions where organization_id = p_org;
  delete from public.schedule_assignments where organization_id = p_org;
  delete from public.work_schedule_days where organization_id = p_org;
  delete from public.work_schedules where organization_id = p_org;
  delete from public.hr_documents where organization_id = p_org;
  delete from public.disciplinary_followups where organization_id = p_org;
  delete from public.disciplinary_records where organization_id = p_org;
  delete from public.employment_events where organization_id = p_org;
  delete from public.employment_periods where organization_id = p_org;
  delete from private.document_verifications where employee_id in (select id from public.employees where organization_id = p_org);
  delete from private.biometric_template_versions where organization_id = p_org;
  delete from private.employee_documents where organization_id = p_org;
  delete from public.attendance_sessions where organization_id = p_org;
  delete from public.attendance_corrections where organization_id = p_org;
  delete from public.sync_acknowledgements where batch_id in (select id from public.sync_batches where organization_id = p_org);
  delete from public.attendance_events where organization_id = p_org;
  delete from public.sync_batches where organization_id = p_org;
  delete from public.incidents where organization_id = p_org;
  delete from public.biometric_enrollments where organization_id = p_org;
  delete from public.biometric_consents where organization_id = p_org;
  delete from public.retention_requests where organization_id = p_org;
  delete from public.employee_status_history where organization_id = p_org;
  delete from public.employee_store_assignments where organization_id = p_org;
  delete from public.employees where organization_id = p_org;
  delete from public.device_health where organization_id = p_org;
  delete from public.device_credentials where organization_id = p_org;
  delete from public.device_enrollments where organization_id = p_org;
  delete from public.devices where organization_id = p_org;
  delete from public.device_policy_versions where organization_id = p_org;
  delete from public.liveness_policy_versions where organization_id = p_org;
  delete from public.security_events where organization_id = p_org;
  delete from public.audit_log where organization_id = p_org;
  delete from public.support_access where organization_id = p_org;
  delete from public.admin_role_grants where organization_id = p_org;
  delete from public.stores where organization_id = p_org;
  delete from public.regions where organization_id = p_org;
  delete from public.hr_catalog where organization_id = p_org;
  delete from public.organizations where id = p_org;
  -- Cuentas de administrador que ya no pertenecen a ninguna organización ni son superadministradores.
  delete from auth.users u where u.id = any(coalesce(v_users, '{}'))
    and not exists (select 1 from public.admin_role_grants g where g.user_id = u.id and g.revoked_at is null);
  insert into public.audit_log (organization_id, actor, actor_kind, action, entity, entity_id)
  values (null, null, 'system', 'purge_org', 'organizations', p_org::text);
end $$;

-- ---------- RLS ----------
alter table public.hr_catalog enable row level security;
alter table public.employment_periods enable row level security;
alter table public.employment_events enable row level security;
alter table public.disciplinary_records enable row level security;
alter table public.disciplinary_followups enable row level security;
alter table public.hr_documents enable row level security;
alter table public.work_schedules enable row level security;
alter table public.work_schedule_days enable row level security;
alter table public.schedule_assignments enable row level security;
alter table public.schedule_exceptions enable row level security;
alter table public.attendance_day_flags enable row level security;
alter table public.alert_rules enable row level security;
alter table public.alerts enable row level security;
alter table public.alert_events enable row level security;

create policy hr_catalog_select on public.hr_catalog for select to authenticated using (private.is_org_member(organization_id));
create policy hr_catalog_insert on public.hr_catalog for insert to authenticated with check (private.has_org_perm('hr.manage', organization_id));
create policy hr_catalog_update on public.hr_catalog for update to authenticated using (private.has_org_perm('hr.manage', organization_id)) with check (private.has_org_perm('hr.manage', organization_id));

create policy periods_select on public.employment_periods for select to authenticated using (private.can_see_employee('hr.read', employee_id));
create policy employment_events_select on public.employment_events for select to authenticated using (private.can_see_employee('hr.read', employee_id));
create policy disciplinary_select on public.disciplinary_records for select to authenticated using (private.can_see_employee('hr.read', employee_id));
create policy disciplinary_followups_select on public.disciplinary_followups for select to authenticated
  using (exists (select 1 from public.disciplinary_records r where r.id = record_id and private.can_see_employee('hr.read', r.employee_id)));
create policy hr_documents_select on public.hr_documents for select to authenticated using (private.has_org_perm('hr.read', organization_id));

create policy schedules_select on public.work_schedules for select to authenticated using (private.is_org_member(organization_id));
create policy schedules_write on public.work_schedules for insert to authenticated with check (private.has_org_perm('schedule.manage', organization_id) and private.feature_on(organization_id, 'schedules'));
create policy schedules_update on public.work_schedules for update to authenticated using (private.has_org_perm('schedule.manage', organization_id)) with check (private.has_org_perm('schedule.manage', organization_id));
create policy schedule_days_select on public.work_schedule_days for select to authenticated using (private.is_org_member(organization_id));
create policy schedule_days_insert on public.work_schedule_days for insert to authenticated with check (private.has_org_perm('schedule.manage', organization_id));
create policy schedule_days_update on public.work_schedule_days for update to authenticated using (private.has_org_perm('schedule.manage', organization_id)) with check (private.has_org_perm('schedule.manage', organization_id));
create policy schedule_days_delete on public.work_schedule_days for delete to authenticated using (private.has_org_perm('schedule.manage', organization_id));
create policy schedule_assign_select on public.schedule_assignments for select to authenticated using (private.is_org_member(organization_id));
create policy schedule_assign_insert on public.schedule_assignments for insert to authenticated with check (private.has_org_perm('schedule.manage', organization_id));
create policy schedule_assign_update on public.schedule_assignments for update to authenticated using (private.has_org_perm('schedule.manage', organization_id)) with check (private.has_org_perm('schedule.manage', organization_id));
create policy schedule_exc_select on public.schedule_exceptions for select to authenticated using (private.is_org_member(organization_id));
create policy schedule_exc_insert on public.schedule_exceptions for insert to authenticated with check (private.has_org_perm('schedule.manage', organization_id));
create policy schedule_exc_delete on public.schedule_exceptions for delete to authenticated using (private.has_org_perm('schedule.manage', organization_id));

create policy day_flags_select on public.attendance_day_flags for select to authenticated
  using (private.can_see_employee('attendance.read', employee_id));
create policy alert_rules_select on public.alert_rules for select to authenticated using (private.is_org_member(organization_id));
create policy alerts_select on public.alerts for select to authenticated using (private.can_see_employee('alert.read', employee_id));
create policy alert_events_select on public.alert_events for select to authenticated
  using (exists (select 1 from public.alerts a where a.id = alert_id and private.can_see_employee('alert.read', a.employee_id)));

-- Auditoría de creación/modificación (las tablas de seguimiento son de solo inserción).
do $$ declare t text; begin
  foreach t in array array['hr_catalog','employment_periods','disciplinary_records','hr_documents','work_schedules','work_schedule_days',
                           'schedule_assignments','schedule_exceptions','alert_rules','alerts'] loop
    execute format('drop trigger if exists trg_audit on public.%I', t);
    execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function private.audit()', t);
  end loop;
  foreach t in array array['employment_events','disciplinary_followups','alert_events'] loop
    execute format('drop trigger if exists trg_append_only on public.%I', t);
    execute format('create trigger trg_append_only before update or delete on public.%I for each row execute function private.append_only()', t);
  end loop;
end $$;

-- Permisos de tabla (las escrituras sensibles van por funciones; horarios y catálogos por RLS).
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant select on public.hr_catalog, public.employment_periods, public.employment_events, public.disciplinary_records,
      public.disciplinary_followups, public.hr_documents, public.work_schedules, public.work_schedule_days, public.schedule_assignments,
      public.schedule_exceptions, public.attendance_day_flags, public.alert_rules, public.alerts, public.alert_events to authenticated';
    execute 'grant insert, update on public.hr_catalog, public.work_schedules, public.work_schedule_days, public.schedule_assignments to authenticated';
    execute 'grant insert, delete on public.schedule_exceptions to authenticated';
    execute 'grant delete on public.work_schedule_days to authenticated';
    execute 'grant execute on function public.platform_create_org(text, text, text, int, boolean, timestamptz, text, text, text, text),
      public.platform_update_org(uuid, text, text, text, text, text, boolean, int, timestamptz, int, int, jsonb), public.platform_orgs(),
      public.terminate_employee(uuid, text, date, text, text, text, uuid), public.rehire_employee(uuid, date, uuid, text),
      public.suspend_employee(uuid, date, date, text), public.reinstate_employee(uuid, text),
      public.create_disciplinary_record(uuid, text, date, uuid, text, text, text, boolean, uuid),
      public.followup_disciplinary_record(uuid, text, text), public.void_disciplinary_record(uuid, text),
      public.register_hr_document(uuid, text, uuid, text, text, text, bigint, text), public.void_hr_document(uuid, text),
      public.alert_followup(uuid, text, text), public.set_alert_rules(uuid, boolean, int, uuid[]), public.recompute_tardiness(uuid, date) to authenticated';
    execute 'grant execute on function private.read_perms(), private.support_perms(), private.feature_on(uuid, text), private.employee_limit(uuid),
      private.current_employee_count(uuid, uuid), private.can_record_discipline(uuid) to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.hr_catalog, public.employment_periods, public.employment_events, public.disciplinary_records,
      public.disciplinary_followups, public.hr_documents, public.work_schedules, public.work_schedule_days, public.schedule_assignments,
      public.schedule_exceptions, public.attendance_day_flags, public.alert_rules, public.alerts, public.alert_events to service_role';
    execute 'grant execute on all functions in schema private to service_role';
  end if;
end $$;
revoke execute on function public.platform_create_org(text, text, text, int, boolean, timestamptz, text, text, text, text),
  public.platform_update_org(uuid, text, text, text, text, text, boolean, int, timestamptz, int, int, jsonb), public.platform_orgs(),
  public.terminate_employee(uuid, text, date, text, text, text, uuid), public.rehire_employee(uuid, date, uuid, text),
  public.suspend_employee(uuid, date, date, text), public.reinstate_employee(uuid, text),
  public.create_disciplinary_record(uuid, text, date, uuid, text, text, text, boolean, uuid),
  public.followup_disciplinary_record(uuid, text, text), public.void_disciplinary_record(uuid, text),
  public.register_hr_document(uuid, text, uuid, text, text, text, bigint, text), public.void_hr_document(uuid, text),
  public.alert_followup(uuid, text, text), public.set_alert_rules(uuid, boolean, int, uuid[]), public.recompute_tardiness(uuid, date) from public, anon;

-- ---------- Documentos: almacenamiento privado (Supabase Storage), carpeta por organización/empleado ----------
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit) values ('hr-documents', 'hr-documents', false, 10485760)
    on conflict (id) do nothing;
    execute $p$create policy hr_docs_read on storage.objects for select to authenticated
      using (bucket_id = 'hr-documents' and private.has_org_perm('hr.read', ((storage.foldername(name))[1])::uuid))$p$;
    execute $p$create policy hr_docs_upload on storage.objects for insert to authenticated
      with check (bucket_id = 'hr-documents' and (private.has_org_perm('hr.manage', ((storage.foldername(name))[1])::uuid)
                  or private.has_org_perm('discipline.manage', ((storage.foldername(name))[1])::uuid)))$p$;
  end if;
end $$;

notify pgrst, 'reload schema';
