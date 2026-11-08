-- =====================================================================================
-- RBAC + Row Level Security
-- Principio: el cliente nunca decide su ámbito. Toda política resuelve permisos a partir de
-- auth.uid() y admin_role_grants; nunca a partir de valores enviados por el cliente.
-- Los dispositivos de tienda NO son usuarios de Postgres: hablan solo con Edge Functions.
-- =====================================================================================

insert into public.roles (code, description) values
  ('superadmin', 'Control total de la plataforma (todas las organizaciones)'),
  ('central_admin', 'Administración central de una organización'),
  ('supervisor', 'Supervisor de tiendas o región: consulta, incidencias, excepciones supervisadas'),
  ('auditor', 'Solo lectura y auditoría de una organización');

insert into public.role_permissions (role, permission)
select 'superadmin'::public.role_code, p from unnest(array[
  'org.manage','store.read','store.manage','employee.read','employee.manage','enrollment.manage','assignment.manage',
  'device.read','device.manage','attendance.read','attendance.correct','incident.read','incident.resolve',
  'audit.read','export.run','privacy.manage','admin.manage','exception.supervise','model.manage']) p
union all
select 'central_admin'::public.role_code, p from unnest(array[
  'store.read','store.manage','employee.read','employee.manage','enrollment.manage','assignment.manage',
  'device.read','device.manage','attendance.read','attendance.correct','incident.read','incident.resolve',
  'audit.read','export.run','privacy.manage','admin.manage','exception.supervise']) p
union all
select 'supervisor'::public.role_code, p from unnest(array[
  'store.read','employee.read','device.read','attendance.read','incident.read','incident.resolve',
  'export.run','exception.supervise']) p
union all
select 'auditor'::public.role_code, p from unnest(array[
  'store.read','employee.read','device.read','attendance.read','incident.read','audit.read','export.run']) p;

-- ---------- Helpers (security definer, search_path fijo) ----------

-- Administrador activo y, si se exige MFA, sesión con nivel aal2.
create or replace function private.admin_session_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admins a
    where a.user_id = auth.uid() and a.status = 'active'
      and (not a.mfa_required or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2')
  );
$$;

create or replace function private.is_superadmin() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.admin_session_ok() and exists (
    select 1 from public.admin_role_grants g
    where g.user_id = auth.uid() and g.revoked_at is null and g.role = 'superadmin');
$$;

-- ¿Tiene el permiso a nivel de organización completa?
create or replace function private.has_org_perm(p_perm text, p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.admin_session_ok() and exists (
    select 1 from public.admin_role_grants g
    join public.role_permissions rp on rp.role = g.role and rp.permission = p_perm
    where g.user_id = auth.uid() and g.revoked_at is null
      and (g.role = 'superadmin'
           or (g.organization_id = p_org and g.store_id is null and g.region_id is null)));
$$;

-- ¿Tiene el permiso sobre una tienda concreta (por organización, región o tienda)?
create or replace function private.has_store_perm(p_perm text, p_store uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.admin_session_ok() and exists (
    select 1 from public.admin_role_grants g
    join public.role_permissions rp on rp.role = g.role and rp.permission = p_perm
    join public.stores s on s.id = p_store
    where g.user_id = auth.uid() and g.revoked_at is null
      and (g.role = 'superadmin'
           or (g.organization_id = s.organization_id and (
                 (g.store_id is null and g.region_id is null)
                 or g.store_id = s.id
                 or (g.store_id is null and g.region_id = s.region_id)))));
$$;

-- Tiendas sobre las que el usuario tiene el permiso.
create or replace function private.store_ids_with(p_perm text) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select s.id from public.stores s
  where private.admin_session_ok() and exists (
    select 1 from public.admin_role_grants g
    join public.role_permissions rp on rp.role = g.role and rp.permission = p_perm
    where g.user_id = auth.uid() and g.revoked_at is null
      and (g.role = 'superadmin'
           or (g.organization_id = s.organization_id and (
                 (g.store_id is null and g.region_id is null)
                 or g.store_id = s.id
                 or (g.store_id is null and g.region_id = s.region_id)))));
$$;

-- ¿Pertenece a la organización con cualquier rol?
create or replace function private.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.admin_session_ok() and exists (
    select 1 from public.admin_role_grants g
    where g.user_id = auth.uid() and g.revoked_at is null
      and (g.role = 'superadmin' or g.organization_id = p_org));
$$;

-- ¿Puede ver al empleado? (permiso en la organización o asignación vigente/histórica a una tienda visible)
create or replace function private.can_see_employee(p_perm text, p_employee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.employees e where e.id = p_employee and private.has_org_perm(p_perm, e.organization_id))
      or exists (select 1 from public.employee_store_assignments a
                 where a.employee_id = p_employee and a.store_id in (select private.store_ids_with(p_perm)));
$$;

revoke all on all functions in schema private from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant usage on schema private to authenticated';
    execute 'grant execute on function private.admin_session_ok(), private.is_superadmin(), private.has_org_perm(text, uuid), private.has_store_perm(text, uuid), private.store_ids_with(text), private.is_org_member(uuid), private.can_see_employee(text, uuid) to authenticated';
  end if;
end $$;

-- ---------- Habilitar RLS en todo ----------
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
  for t in select tablename from pg_tables where schemaname = 'private' loop
    execute format('alter table private.%I enable row level security', t); -- sin políticas: solo service_role/owner
  end loop;
end $$;

-- Permisos de tabla de base (RLS filtra filas). anon no recibe nada.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
    execute 'revoke all on all sequences in schema public from anon';
    execute 'revoke all on all functions in schema public from anon';
    execute 'alter default privileges in schema public revoke all on tables from anon';
    execute 'alter default privileges in schema public revoke all on functions from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema public from authenticated';
    execute 'grant select on all tables in schema public to authenticated';
    execute 'grant insert, update on public.organizations, public.regions, public.stores, public.employees, public.devices, public.device_policy_versions, public.liveness_policy_versions, public.biometric_consents, public.retention_requests, public.model_versions to authenticated';
    execute 'grant insert on public.employee_store_assignments to authenticated';
  end if;
end $$;

-- ---------- Políticas ----------
-- Organizaciones
create policy org_select on public.organizations for select to authenticated using (private.is_org_member(id));
create policy org_insert on public.organizations for insert to authenticated with check (private.is_superadmin());
create policy org_update on public.organizations for update to authenticated using (private.is_superadmin()) with check (private.is_superadmin());

-- Regiones
create policy regions_select on public.regions for select to authenticated using (private.is_org_member(organization_id));
create policy regions_write on public.regions for insert to authenticated with check (private.has_org_perm('store.manage', organization_id));
create policy regions_update on public.regions for update to authenticated
  using (private.has_org_perm('store.manage', organization_id)) with check (private.has_org_perm('store.manage', organization_id));

-- Tiendas
create policy stores_select on public.stores for select to authenticated using (id in (select private.store_ids_with('store.read')));
create policy stores_insert on public.stores for insert to authenticated with check (private.has_org_perm('store.manage', organization_id));
create policy stores_update on public.stores for update to authenticated
  using (private.has_org_perm('store.manage', organization_id)) with check (private.has_org_perm('store.manage', organization_id));

-- Empleados (sin DELETE: las bajas son cambios de estado)
create policy employees_select on public.employees for select to authenticated using (private.can_see_employee('employee.read', id));
create policy employees_insert on public.employees for insert to authenticated with check (private.has_org_perm('employee.manage', organization_id));
create policy employees_update on public.employees for update to authenticated
  using (private.has_org_perm('employee.manage', organization_id)) with check (private.has_org_perm('employee.manage', organization_id));

create policy esh_select on public.employee_status_history for select to authenticated using (private.can_see_employee('employee.read', employee_id));

-- Asignaciones (inserción directa permitida; traslados y revocaciones por RPC)
create policy esa_select on public.employee_store_assignments for select to authenticated
  using (private.has_org_perm('employee.read', organization_id) or store_id in (select private.store_ids_with('employee.read')));
create policy esa_insert on public.employee_store_assignments for insert to authenticated
  with check (private.has_org_perm('assignment.manage', organization_id) and revoked_at is null);

-- Administradores y roles
create policy admins_select on public.admins for select to authenticated
  using (user_id = auth.uid() or private.is_superadmin() or exists (
    select 1 from public.admin_role_grants g where g.user_id = admins.user_id and g.revoked_at is null
      and g.organization_id is not null and private.has_org_perm('admin.manage', g.organization_id)));
create policy grants_select on public.admin_role_grants for select to authenticated
  using (user_id = auth.uid() or private.is_superadmin()
         or (organization_id is not null and private.has_org_perm('admin.manage', organization_id)));
create policy roles_select on public.roles for select to authenticated using (true);
create policy role_permissions_select on public.role_permissions for select to authenticated using (true);

-- Dispositivos
create policy devices_select on public.devices for select to authenticated using (store_id in (select private.store_ids_with('device.read')));
create policy devices_insert on public.devices for insert to authenticated
  with check (private.has_org_perm('device.manage', organization_id) and status = 'pending');
create policy devices_update on public.devices for update to authenticated
  using (private.has_org_perm('device.manage', organization_id)) with check (private.has_org_perm('device.manage', organization_id));
create policy device_credentials_select on public.device_credentials for select to authenticated
  using (device_id in (select d.id from public.devices d where d.store_id in (select private.store_ids_with('device.read'))));
create policy device_health_select on public.device_health for select to authenticated
  using (device_id in (select d.id from public.devices d where d.store_id in (select private.store_ids_with('device.read'))));
-- device_enrollments: sin políticas (solo RPC / service_role). Los hashes de códigos no se exponen.
create policy dpv_select on public.device_policy_versions for select to authenticated using (private.is_org_member(organization_id));
create policy dpv_insert on public.device_policy_versions for insert to authenticated with check (private.has_org_perm('device.manage', organization_id));

-- Modelos
create policy models_select on public.model_versions for select to authenticated using (private.admin_session_ok());
create policy models_insert on public.model_versions for insert to authenticated with check (private.is_superadmin());
create policy models_update on public.model_versions for update to authenticated using (private.is_superadmin()) with check (private.is_superadmin());
create policy lpv_select on public.liveness_policy_versions for select to authenticated using (private.is_org_member(organization_id));
create policy lpv_insert on public.liveness_policy_versions for insert to authenticated with check (private.has_org_perm('enrollment.manage', organization_id));

-- Biometría (las plantillas están en private.*; aquí solo metadatos)
create policy consents_select on public.biometric_consents for select to authenticated
  using (private.has_org_perm('enrollment.manage', organization_id) or private.has_org_perm('privacy.manage', organization_id));
create policy consents_insert on public.biometric_consents for insert to authenticated
  with check (private.has_org_perm('enrollment.manage', organization_id) and recorded_by = auth.uid());
create policy consents_update on public.biometric_consents for update to authenticated
  using (private.has_org_perm('privacy.manage', organization_id)) with check (private.has_org_perm('privacy.manage', organization_id));
create policy enrollments_select on public.biometric_enrollments for select to authenticated
  using (private.can_see_employee('employee.read', employee_id));

-- Sincronización
create policy sync_batches_select on public.sync_batches for select to authenticated
  using (device_id in (select d.id from public.devices d where d.store_id in (select private.store_ids_with('device.read'))));
create policy sync_acks_select on public.sync_acknowledgements for select to authenticated
  using (batch_id in (select b.id from public.sync_batches b));

-- Asistencia: lectura por tienda; escritura solo por ingesta (service_role) o RPC de corrección.
create policy events_select on public.attendance_events for select to authenticated
  using (store_id in (select private.store_ids_with('attendance.read')));
create policy sessions_select on public.attendance_sessions for select to authenticated
  using (store_id in (select private.store_ids_with('attendance.read')));
create policy corrections_select on public.attendance_corrections for select to authenticated
  using (private.has_org_perm('attendance.read', organization_id)
         or exists (select 1 from public.attendance_events e where e.id in (attendance_corrections.target_event_id, attendance_corrections.new_event_id)
                    and e.store_id in (select private.store_ids_with('attendance.read'))));

-- Incidencias
create policy incidents_select on public.incidents for select to authenticated
  using (case when store_id is null then private.has_org_perm('incident.read', organization_id)
              else store_id in (select private.store_ids_with('incident.read')) end);

-- Seguridad y auditoría
create policy security_events_select on public.security_events for select to authenticated
  using (organization_id is not null and private.has_org_perm('audit.read', organization_id) or private.is_superadmin());
create policy audit_select on public.audit_log for select to authenticated
  using (organization_id is not null and private.has_org_perm('audit.read', organization_id) or private.is_superadmin());

-- Privacidad
create policy retention_select on public.retention_requests for select to authenticated using (private.has_org_perm('privacy.manage', organization_id));
create policy retention_insert on public.retention_requests for insert to authenticated
  with check (private.has_org_perm('privacy.manage', organization_id) and requested_by = auth.uid() and status = 'requested');
