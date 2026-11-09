-- Plataforma multi-organización (SaaS):
-- * El superadministrador opera la plataforma: ve cifras de uso, planes y estado de cada organización, puede suspender,
--   reactivar, asignar plan o «sin límite». NO ve ni modifica datos de una organización salvo acceso de soporte
--   temporal y de solo lectura que la propia organización le concede (queda en su auditoría).
-- * Cada organización administra lo suyo (sucursales, empleados, teléfonos, permisos de enrolamiento, administradores).
-- * Planes por empleados con rostro registrado: 1–5 gratis; 6–10; 11–20; 21–30; 31–50; 51–100; 101–150; … (de 50 en 50).
--   Al llegar al límite: aviso y no se puede enrolar a nadie más (todo lo demás sigue).
-- * Membresía vencida o organización suspendida: panel en solo lectura (descargar datos, eliminar cuenta) y los teléfonos
--   dejan de marcar. Eliminación de cuenta: los datos se conservan 90 días por si vuelve a suscribirse; luego se borran.
-- * Registro de organizaciones desde la app (cuenta con correo confirmado → complete_signup).

alter table public.organizations
  add column if not exists status text not null default 'active' check (status in ('active', 'suspended', 'pending_deletion')),
  add column if not exists unlimited boolean not null default false,
  add column if not exists paid_max_employees int check (paid_max_employees is null or paid_max_employees > 5),
  add column if not exists paid_until timestamptz,
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_reason text,
  add column if not exists deletion_requested_at timestamptz,
  add column if not exists deletion_due_at timestamptz,
  add column if not exists country_code char(2) check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  add column if not exists terms_version text,
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists created_via text not null default 'platform' check (created_via in ('platform', 'app_signup', 'owner'));

-- ---------- Planes ----------
create or replace function private.tier_max(n int) returns int language sql immutable set search_path = '' as $$
  select case when n <= 5 then 5 when n <= 10 then 10 when n <= 20 then 20 when n <= 30 then 30 when n <= 50 then 50
              else (ceil(n / 50.0) * 50)::int end;
$$;
create or replace function private.tier_label(m int) returns text language sql immutable set search_path = '' as $$
  select case m when 5 then 'Gratis (1–5 empleados)' when 10 then '6–10 empleados' when 20 then '11–20 empleados'
              when 30 then '21–30 empleados' when 50 then '31–50 empleados' else (m - 49) || '–' || m || ' empleados' end;
$$;

-- Acceso de la organización: 'full' o 'read_only' (suspendida, en eliminación o membresía pagada vencida).
create or replace function private.org_access(p_org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when o.status <> 'active' then 'read_only'
              when o.unlimited then 'full'
              when o.paid_max_employees is not null and o.paid_until is not null and o.paid_until < now() then 'read_only'
              else 'full' end
  from public.organizations o where o.id = p_org;
$$;
-- Máximo de empleados con rostro registrado (null = sin límite).
create or replace function private.enroll_limit(p_org uuid) returns int
language sql stable security definer set search_path = '' as $$
  select case when o.unlimited then null else coalesce(o.paid_max_employees, 5) end from public.organizations o where o.id = p_org;
$$;
create or replace function private.enrolled_count(p_org uuid) returns int
language sql stable security definer set search_path = '' as $$
  select count(distinct be.employee_id)::int from public.biometric_enrollments be join public.employees e on e.id = be.employee_id
   where be.organization_id = p_org and be.status = 'active' and e.status = 'active';
$$;

-- ---------- Acceso de soporte (concedido por la organización, temporal, solo lectura) ----------
create table if not exists public.support_access (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  granted_by uuid not null,
  reason text,
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
alter table public.support_access enable row level security;

create or replace function private.support_active(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_superadmin() and exists (select 1 from public.support_access s where s.organization_id = p_org
           and s.revoked_at is null and s.expires_at > now());
$$;

-- Administrador central de la organización (independiente de si está en solo lectura).
create or replace function private.is_org_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.admin_session_ok() and exists (select 1 from public.admin_role_grants g where g.user_id = auth.uid()
           and g.revoked_at is null and g.role = 'central_admin' and g.organization_id = p_org);
$$;

-- ---------- Permisos: el superadministrador ya no tiene acceso implícito a los datos de las organizaciones ----------
create or replace function private.has_org_perm(p_perm text, p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.admin_session_ok() and (
    (exists (select 1 from public.admin_role_grants g join public.role_permissions rp on rp.role = g.role and rp.permission = p_perm
             where g.user_id = auth.uid() and g.revoked_at is null and g.role <> 'superadmin'
               and g.organization_id = p_org and g.store_id is null and g.region_id is null)
     and (p_perm = any(array['store.read','employee.read','device.read','attendance.read','incident.read','audit.read','export.run']) or private.org_access(p_org) = 'full'))
    or (p_perm = any(array['store.read','employee.read','device.read','attendance.read','incident.read','audit.read','export.run']) and private.support_active(p_org)));
$$;

create or replace function private.has_store_perm(p_perm text, p_store uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.admin_session_ok() and exists (select 1 from public.stores s where s.id = p_store and (
    (exists (select 1 from public.admin_role_grants g join public.role_permissions rp on rp.role = g.role and rp.permission = p_perm
             where g.user_id = auth.uid() and g.revoked_at is null and g.role <> 'superadmin' and g.organization_id = s.organization_id
               and ((g.store_id is null and g.region_id is null) or g.store_id = s.id or (g.store_id is null and g.region_id = s.region_id)))
     and (p_perm = any(array['store.read','employee.read','device.read','attendance.read','incident.read','audit.read','export.run']) or private.org_access(s.organization_id) = 'full'))
    or (p_perm = any(array['store.read','employee.read','device.read','attendance.read','incident.read','audit.read','export.run']) and private.support_active(s.organization_id))));
$$;

create or replace function private.store_ids_with(p_perm text) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select s.id from public.stores s
  where private.admin_session_ok() and (
    (exists (select 1 from public.admin_role_grants g join public.role_permissions rp on rp.role = g.role and rp.permission = p_perm
             where g.user_id = auth.uid() and g.revoked_at is null and g.role <> 'superadmin' and g.organization_id = s.organization_id
               and ((g.store_id is null and g.region_id is null) or g.store_id = s.id or (g.store_id is null and g.region_id = s.region_id)))
     and (p_perm = any(array['store.read','employee.read','device.read','attendance.read','incident.read','audit.read','export.run']) or private.org_access(s.organization_id) = 'full'))
    or (p_perm = any(array['store.read','employee.read','device.read','attendance.read','incident.read','audit.read','export.run']) and private.support_active(s.organization_id)));
$$;

create or replace function private.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.admin_session_ok() and (
    exists (select 1 from public.admin_role_grants g where g.user_id = auth.uid() and g.revoked_at is null
              and g.role <> 'superadmin' and g.organization_id = p_org)
    or private.support_active(p_org));
$$;

-- Organizaciones: sin alta directa (registro con complete_signup / platform_create_own_org); los administradores de la
-- organización solo pueden cambiar nombre y prefijo; plan y estado solo por funciones de plataforma.
drop policy if exists org_insert on public.organizations;
drop policy if exists org_update on public.organizations;
revoke insert, update on public.organizations from authenticated;
grant update (name, employee_code_prefix) on public.organizations to authenticated;
create policy org_update on public.organizations for update to authenticated
  using (private.has_org_perm('store.manage', id)) with check (private.has_org_perm('store.manage', id));

-- Auditoría y seguridad: el superadministrador ve solo lo de plataforma (sin organización) o con soporte activo.
drop policy if exists security_events_select on public.security_events;
create policy security_events_select on public.security_events for select to authenticated
  using ((organization_id is not null and private.has_org_perm('audit.read', organization_id)) or (organization_id is null and private.is_superadmin()));
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated
  using ((organization_id is not null and private.has_org_perm('audit.read', organization_id)) or (organization_id is null and private.is_superadmin()));

create policy support_select on public.support_access for select to authenticated
  using (private.is_org_admin(organization_id) or private.is_superadmin());

-- Eventos registrados por teléfonos cuando la organización está en solo lectura → revisión (el teléfono ya lo impide).
create or replace function private.flag_inactive_org_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.org_access(new.organization_id) = 'read_only' then
    new.status := 'needs_review';
    new.review_reasons := array_append(coalesce(new.review_reasons, '{}'), 'org_inactive');
  end if;
  return new;
end $$;
drop trigger if exists trg_flag_inactive_org on public.attendance_events;
create trigger trg_flag_inactive_org before insert on public.attendance_events for each row execute function private.flag_inactive_org_event();

create or replace function public.enroll_biometric(
  p_employee_id uuid, p_consent_id uuid, p_store_id uuid, p_identity_method text,
  p_samples text[], p_quality jsonb, p_pad_passed boolean, p_pad_score real,
  p_recognition_model_id uuid, p_pad_model_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_emp public.employees%rowtype; v_model public.model_versions%rowtype; v_enr uuid := gen_random_uuid();
  s text; v_bytes bytea; v_key text; v_ver uuid; v_limit int;
begin
  select * into v_emp from public.employees where id = p_employee_id;
  if not found or not private.has_org_perm('enrollment.manage', v_emp.organization_id) then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  if v_emp.status <> 'active' then raise exception 'empleado no activo'; end if;
  -- Límite del plan: empleados con rostro registrado (reenrolar a alguien ya enrolado no cuenta).
  v_limit := private.enroll_limit(v_emp.organization_id);
  if v_limit is not null and not exists (select 1 from public.biometric_enrollments where employee_id = p_employee_id and status = 'active')
     and private.enrolled_count(v_emp.organization_id) >= v_limit then
    raise exception 'Límite del plan alcanzado: % empleados con rostro registrado (su plan permite %). Para enrolar más, contrate el plan %.',
      private.enrolled_count(v_emp.organization_id), v_limit, private.tier_label(private.tier_max(v_limit + 1)) using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.stores where id = p_store_id and organization_id = v_emp.organization_id and is_central) then
    raise exception 'el enrolamiento solo se permite en una sede central de la organización';
  end if;
  if not exists (select 1 from public.biometric_consents where id = p_consent_id and employee_id = p_employee_id and withdrawn_at is null) then
    raise exception 'no existe consentimiento vigente para este empleado';
  end if;
  -- Teléfono autorizado: la sesión del administrador debe estar ligada (bind_enroll_ticket) a un teléfono activo de la
  -- organización con permiso de enrolamiento vigente. Si en el panel se retira el permiso, deja de valer al instante.
  if not exists (select 1 from private.enroll_tickets t join public.devices d on d.id = t.device_id
                 where t.bound_user = auth.uid() and t.revoked_at is null and t.bound_at > now() - interval '4 hours'
                   and d.status = 'active' and d.can_enroll and d.organization_id = v_emp.organization_id) then
    raise exception 'teléfono no autorizado para enrolar: active «Puede enrolar» para este teléfono en el panel (Teléfonos)' using errcode = '42501';
  end if;
  -- Identidad: el número de documento escrito en el enrolamiento debe coincidir con el registrado (verify_employee_document, ≤ 30 min, un solo uso).
  update private.document_verifications set used_at = now()
   where id = (select id from private.document_verifications where employee_id = p_employee_id and verified_by = auth.uid()
                 and used_at is null and verified_at > now() - interval '30 minutes' order by verified_at desc limit 1)
  returning id into v_ver;
  if v_ver is null then raise exception 'identidad no verificada: escriba el número de documento del empleado (debe coincidir con el registrado)' using errcode = '42501'; end if;
  if p_pad_passed is not true then raise exception 'la prueba de vida no fue superada; enrolamiento rechazado'; end if;
  select * into v_model from public.model_versions where id = p_recognition_model_id and kind = 'recognition' and status <> 'retired';
  if not found or v_model.embedding_dim is null then raise exception 'modelo de reconocimiento no válido'; end if;
  if coalesce(array_length(p_samples, 1), 0) not between 3 and 10 then raise exception 'se requieren entre 3 y 10 muestras'; end if;
  if length(coalesce(trim(p_identity_method), '')) < 3 then raise exception 'método de verificación de identidad requerido'; end if;

  v_key := private.template_key();
  -- Reenrolamiento: la plantilla anterior queda sustituida y se elimina en los teléfonos en la siguiente sincronización.
  update public.biometric_enrollments set status = 'superseded', revoked_at = now(), revoked_reason = 'reenrolamiento'
   where employee_id = p_employee_id and status = 'active';
  update private.biometric_template_versions set revoked_at = now() where employee_id = p_employee_id and revoked_at is null;

  insert into public.biometric_enrollments (id, organization_id, employee_id, consent_id, enrolled_by, enrolled_at_store_id,
    identity_verification_method, sample_count, quality, pad_passed, pad_score, recognition_model_id, pad_model_id)
  values (v_enr, v_emp.organization_id, p_employee_id, p_consent_id, auth.uid(), p_store_id, p_identity_method,
          array_length(p_samples, 1), coalesce(p_quality, '{}'), true, p_pad_score, p_recognition_model_id, p_pad_model_id);

  foreach s in array p_samples loop
    v_bytes := decode(translate(s, '-_', '+/') || repeat('=', (4 - length(s) % 4) % 4), 'base64');
    if length(v_bytes) <> v_model.embedding_dim * 4 then
      raise exception 'dimensión de muestra inválida (esperado % float32)', v_model.embedding_dim;
    end if;
    insert into private.biometric_template_versions (organization_id, enrollment_id, employee_id, model_version_id, dims, key_id, ciphertext)
    values (v_emp.organization_id, v_enr, p_employee_id, p_recognition_model_id, v_model.embedding_dim, 'vault:template_enc_key',
            extensions.pgp_sym_encrypt(encode(v_bytes, 'base64'), v_key, 'cipher-algo=aes256'));
  end loop;
  return v_enr;
end $$;

create or replace function private.device_pull(p_device_id uuid, p_known_employee_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_dev public.devices%rowtype; v_store public.stores%rowtype; v_policy jsonb; v_lease int; v_roster jsonb; v_key text;
begin
  select * into v_dev from public.devices where id = p_device_id;
  if not found then raise exception 'device_not_found'; end if;
  select * into v_store from public.stores where id = v_dev.store_id;
  select jsonb_set(p.policy, '{version}', to_jsonb(p.version)) into v_policy from public.device_policy_versions p
   where p.organization_id = v_dev.organization_id order by p.version desc limit 1;
  v_lease := coalesce((v_policy ->> 'leaseHours')::int, 168);

  if v_dev.status <> 'active' then
    return jsonb_build_object('serverTime', now(), 'policy', v_policy, 'rosterVersion', null, 'roster', '[]'::jsonb,
      'revokedEmployeeIds', to_jsonb(coalesce(p_known_employee_ids, '{}')),
      'device', jsonb_build_object('status', v_dev.status, 'storeId', v_store.id, 'storeName', v_store.name, 'timezone', v_store.timezone));
  end if;

  v_key := private.template_key();
  select coalesce(jsonb_agg(jsonb_build_object(
           'employeeId', r.employee_id, 'displayName', r.display_name, 'gender', r.gender, 'leaseExpiresAt', r.lease_expires_at,
           'lastEvent', case when r.last_event_id is null then null else
              jsonb_build_object('id', r.last_event_id, 'eventType', r.last_event_type, 'occurredAt', r.last_event_at,
                'outKind', case when 'out_break' = any(r.last_event_flags) then 'break' when 'out_end' = any(r.last_event_flags) then 'end' end) end,
           'templates', (select coalesce(jsonb_agg(jsonb_build_object(
                'templateId', t.id, 'modelVersion', m.name || '@' || m.version, 'dims', t.dims,
                'vectorB64', extensions.pgp_sym_decrypt(t.ciphertext, v_key))), '[]'::jsonb)
              from private.biometric_template_versions t join public.model_versions m on m.id = t.model_version_id
              join public.biometric_enrollments be on be.id = t.enrollment_id and be.status = 'active'
              where t.employee_id = r.employee_id and t.revoked_at is null)
         ) order by r.employee_id), '[]'::jsonb)
    into v_roster
  from private.device_roster(p_device_id, v_lease) r;

  update public.devices set last_seen_at = now(), last_sync_at = now() where id = p_device_id;
  return jsonb_build_object(
    'serverTime', now(), 'policy', v_policy,
    'rosterVersion', md5(v_roster::text),
    'roster', v_roster,
    'revokedEmployeeIds', to_jsonb(array(
       select k from unnest(coalesce(p_known_employee_ids, '{}')) k
       where not exists (select 1 from jsonb_array_elements(v_roster) x where (x ->> 'employeeId')::uuid = k))),
    'device', jsonb_build_object('status', v_dev.status, 'storeId', v_store.id, 'storeName', v_store.name, 'timezone', v_store.timezone,
                                 'canEnroll', v_dev.can_enroll and private.org_access(v_dev.organization_id) = 'full',
                                 'orgAccess', private.org_access(v_dev.organization_id)));
end $$;

-- ---------- Estado del plan para la organización (avisos en panel) ----------
create or replace function public.org_plan_status(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare o public.organizations%rowtype; v_lim int; v_n int; v_warn text[] := '{}';
begin
  if not private.is_org_member(p_org) then raise exception 'permiso denegado' using errcode = '42501'; end if;
  select * into o from public.organizations where id = p_org;
  v_lim := private.enroll_limit(p_org); v_n := private.enrolled_count(p_org);
  if o.status = 'suspended' then v_warn := v_warn || 'suspended'::text; end if;
  if o.status = 'pending_deletion' then v_warn := v_warn || 'pending_deletion'::text; end if;
  if not o.unlimited and o.paid_max_employees is not null and o.paid_until is not null then
    if o.paid_until < now() then v_warn := v_warn || 'expired'::text;
    elsif o.paid_until < now() + interval '7 days' then v_warn := v_warn || 'expiring_soon'::text; end if;
  end if;
  if v_lim is not null and v_n >= v_lim then v_warn := v_warn || 'at_limit'::text;
  elsif v_lim is not null and v_n >= ceil(v_lim * 0.8) then v_warn := v_warn || 'near_limit'::text; end if;
  return jsonb_build_object('status', o.status, 'access', private.org_access(p_org), 'unlimited', o.unlimited,
    'limit', v_lim, 'enrolled', v_n, 'planLabel', case when o.unlimited then 'Sin límite' else private.tier_label(coalesce(o.paid_max_employees, 5)) end,
    'nextPlanLabel', case when v_lim is null then null else private.tier_label(private.tier_max(v_lim + 1)) end,
    'paidUntil', o.paid_until, 'suspendedReason', o.suspended_reason, 'deletionDueAt', o.deletion_due_at,
    'supportUntil', (select max(expires_at) from public.support_access where organization_id = p_org and revoked_at is null and expires_at > now()),
    'warnings', to_jsonb(v_warn));
end $$;

-- ---------- Soporte ----------
create or replace function public.grant_support_access(p_org uuid, p_hours int, p_reason text) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v_exp timestamptz;
begin
  if not private.is_org_admin(p_org) then raise exception 'permiso denegado' using errcode = '42501'; end if;
  if p_hours not between 1 and 72 then raise exception 'duración entre 1 y 72 horas'; end if;
  v_exp := now() + make_interval(hours => p_hours);
  insert into public.support_access (organization_id, granted_by, reason, expires_at) values (p_org, auth.uid(), left(p_reason, 300), v_exp);
  insert into public.audit_log (organization_id, actor, actor_kind, action, entity, entity_id, after)
  values (p_org, auth.uid(), 'admin', 'grant_support_access', 'organizations', p_org::text, jsonb_build_object('hours', p_hours, 'reason', p_reason));
  return v_exp;
end $$;
create or replace function public.revoke_support_access(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_org_admin(p_org) then raise exception 'permiso denegado' using errcode = '42501'; end if;
  update public.support_access set revoked_at = now() where organization_id = p_org and revoked_at is null;
  insert into public.audit_log (organization_id, actor, actor_kind, action, entity, entity_id)
  values (p_org, auth.uid(), 'admin', 'revoke_support_access', 'organizations', p_org::text);
end $$;

-- ---------- Eliminación de la cuenta (90 días de conservación) ----------
create or replace function public.request_org_deletion(p_org uuid, p_confirm_name text) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare o public.organizations%rowtype;
begin
  if not private.is_org_admin(p_org) then raise exception 'permiso denegado' using errcode = '42501'; end if;
  select * into o from public.organizations where id = p_org for update;
  if lower(trim(p_confirm_name)) <> lower(trim(o.name)) then raise exception 'Escriba exactamente el nombre de la organización para confirmar'; end if;
  update public.organizations set status = 'pending_deletion', deletion_requested_at = now(), deletion_due_at = now() + interval '90 days'
   where id = p_org returning deletion_due_at into o.deletion_due_at;
  insert into public.audit_log (organization_id, actor, actor_kind, action, entity, entity_id, after)
  values (p_org, auth.uid(), 'admin', 'request_org_deletion', 'organizations', p_org::text, jsonb_build_object('due', o.deletion_due_at));
  return o.deletion_due_at;
end $$;
create or replace function public.cancel_org_deletion(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_org_admin(p_org) then raise exception 'permiso denegado' using errcode = '42501'; end if;
  update public.organizations set status = 'active', deletion_requested_at = null, deletion_due_at = null
   where id = p_org and status = 'pending_deletion';
  insert into public.audit_log (organization_id, actor, actor_kind, action, entity, entity_id)
  values (p_org, auth.uid(), 'admin', 'cancel_org_deletion', 'organizations', p_org::text);
end $$;

-- Borrado definitivo de una organización (todas sus tablas). Solo lo ejecuta la tarea programada (o postgres).
create or replace function private.purge_org(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_users uuid[];
begin
  perform set_config('app.retention_purge', 'on', true);
  select array_agg(distinct user_id) into v_users from public.admin_role_grants where organization_id = p_org;
  delete from private.enroll_tickets where device_id in (select id from public.devices where organization_id = p_org);
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
  delete from public.organizations where id = p_org;
  -- Cuentas de administrador que ya no pertenecen a ninguna organización ni son superadministradores.
  delete from auth.users u where u.id = any(coalesce(v_users, '{}'))
    and not exists (select 1 from public.admin_role_grants g where g.user_id = u.id and g.revoked_at is null);
  insert into public.audit_log (organization_id, actor, actor_kind, action, entity, entity_id)
  values (null, null, 'system', 'purge_org', 'organizations', p_org::text);
end $$;
create or replace function private.purge_due_orgs() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select id from public.organizations where status = 'pending_deletion' and deletion_due_at < now() loop
    perform private.purge_org(r.id); n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- Plataforma (solo superadministrador) ----------
create or replace function public.platform_orgs() returns table (
  id uuid, name text, country_code char(2), status text, access text, created_at timestamptz, created_via text,
  employees_active int, employees_enrolled int, stores int, devices_active int, punches_30d int, last_activity timestamptz,
  unlimited boolean, paid_max_employees int, paid_until timestamptz, needed_tier_label text, plan_label text, over_limit boolean,
  admin_contacts text, support_until timestamptz, deletion_due_at timestamptz, suspended_reason text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_superadmin() then raise exception 'permiso denegado' using errcode = '42501'; end if;
  return query
  select o.id, o.name, o.country_code, o.status, private.org_access(o.id), o.created_at, o.created_via,
    (select count(*)::int from public.employees e where e.organization_id = o.id and e.status = 'active'),
    private.enrolled_count(o.id),
    (select count(*)::int from public.stores s where s.organization_id = o.id and s.status = 'active'),
    (select count(*)::int from public.devices d where d.organization_id = o.id and d.status = 'active'),
    (select count(*)::int from public.attendance_events a where a.organization_id = o.id and a.received_at > now() - interval '30 days'),
    (select max(d.last_seen_at) from public.devices d where d.organization_id = o.id),
    o.unlimited, o.paid_max_employees, o.paid_until,
    private.tier_label(private.tier_max(greatest(private.enrolled_count(o.id), 1))),
    case when o.unlimited then 'Sin límite' else private.tier_label(coalesce(o.paid_max_employees, 5)) end,
    (not o.unlimited and private.enrolled_count(o.id) > coalesce(o.paid_max_employees, 5)),
    (select string_agg(a.display_name || ' <' || a.email || '>', ', ') from public.admin_role_grants g join public.admins a on a.user_id = g.user_id
      where g.organization_id = o.id and g.role = 'central_admin' and g.revoked_at is null),
    (select max(s.expires_at) from public.support_access s where s.organization_id = o.id and s.revoked_at is null and s.expires_at > now()),
    o.deletion_due_at, o.suspended_reason
  from public.organizations o order by o.created_at;
end $$;

create or replace function public.platform_set_plan(p_org uuid, p_unlimited boolean, p_paid_max int, p_paid_until timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_superadmin() then raise exception 'permiso denegado' using errcode = '42501'; end if;
  if p_paid_max is not null and p_paid_max <> private.tier_max(p_paid_max) then raise exception 'el plan debe ser un tramo válido (10, 20, 30, 50, 100, 150…)'; end if;
  update public.organizations set unlimited = coalesce(p_unlimited, false),
    paid_max_employees = case when p_paid_max is null or p_paid_max <= 5 then null else p_paid_max end,
    paid_until = case when p_paid_max is null or p_paid_max <= 5 then null else p_paid_until end
   where id = p_org;
  if not found then raise exception 'organización inexistente'; end if;
  insert into public.audit_log (organization_id, actor, actor_kind, action, entity, entity_id, after)
  values (null, auth.uid(), 'admin', 'platform_set_plan', 'organizations', p_org::text,
          jsonb_build_object('unlimited', p_unlimited, 'paid_max', p_paid_max, 'paid_until', p_paid_until));
end $$;

create or replace function public.platform_set_status(p_org uuid, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_superadmin() then raise exception 'permiso denegado' using errcode = '42501'; end if;
  if p_status not in ('active', 'suspended') then raise exception 'estado no permitido'; end if;
  if p_status = 'suspended' and length(coalesce(trim(p_reason), '')) < 5 then raise exception 'motivo requerido'; end if;
  update public.organizations set status = p_status,
    suspended_at = case when p_status = 'suspended' then now() end, suspended_reason = case when p_status = 'suspended' then p_reason end,
    deletion_requested_at = case when p_status = 'active' then null else deletion_requested_at end,
    deletion_due_at = case when p_status = 'active' then null else deletion_due_at end
   where id = p_org;
  if not found then raise exception 'organización inexistente'; end if;
  insert into public.audit_log (organization_id, actor, actor_kind, action, entity, entity_id, after)
  values (null, auth.uid(), 'admin', 'platform_set_status', 'organizations', p_org::text, jsonb_build_object('status', p_status, 'reason', p_reason));
end $$;

-- Zona horaria por país (Centroamérica) para la región inicial.
create or replace function private.country_tz(p text) returns text language sql immutable set search_path = '' as $$
  select case p when 'GT' then 'America/Guatemala' when 'SV' then 'America/El_Salvador' when 'HN' then 'America/Tegucigalpa'
    when 'NI' then 'America/Managua' when 'CR' then 'America/Costa_Rica' when 'PA' then 'America/Panama' when 'BZ' then 'America/Belize'
    else 'America/Guatemala' end;
$$;
create or replace function private.country_name(p text) returns text language sql immutable set search_path = '' as $$
  select case p when 'GT' then 'Guatemala' when 'SV' then 'El Salvador' when 'HN' then 'Honduras' when 'NI' then 'Nicaragua'
    when 'CR' then 'Costa Rica' when 'PA' then 'Panamá' when 'BZ' then 'Belice' else p end;
$$;
create or replace function private.create_org(p_name text, p_country text, p_via text, p_unlimited boolean, p_terms text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prefix text;
begin
  if length(coalesce(trim(p_name), '')) < 2 then raise exception 'Escriba el nombre de la organización'; end if;
  if p_country !~ '^[A-Z]{2}$' then raise exception 'País no válido'; end if;
  v_prefix := left(upper(regexp_replace(private.normalize_document(p_name), '[^A-Z0-9]', '', 'g')) || 'ORG', 4);
  insert into public.organizations (name, employee_code_prefix, country_code, created_via, unlimited, terms_version, terms_accepted_at)
  values (trim(p_name), v_prefix, p_country, p_via, coalesce(p_unlimited, false), p_terms, case when p_terms is not null then now() end)
  returning id into v_org;
  insert into public.regions (organization_id, country_code, name, timezone) values (v_org, p_country, private.country_name(p_country), private.country_tz(p_country));
  return v_org;
end $$;

-- Organización propia del dueño de la plataforma (sin límite); el superadministrador queda como su administrador central.
create or replace function public.platform_create_own_org(p_name text, p_country text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  if not private.is_superadmin() then raise exception 'permiso denegado' using errcode = '42501'; end if;
  v_org := private.create_org(p_name, p_country, 'owner', true, null);
  insert into public.admin_role_grants (user_id, role, organization_id, granted_by) values (auth.uid(), 'central_admin', v_org, auth.uid());
  insert into public.audit_log (organization_id, actor, actor_kind, action, entity, entity_id) values (null, auth.uid(), 'admin', 'platform_create_own_org', 'organizations', v_org::text);
  return v_org;
end $$;

-- Registro desde la app: tras confirmar el correo, el primer inicio de sesión crea la organización con los datos que la
-- persona escribió al registrarse (raw_user_meta_data.signup) y la deja como administradora central.
create or replace function public.complete_signup() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u auth.users%rowtype; s jsonb; v_org uuid;
begin
  select * into u from auth.users where id = auth.uid();
  if not found then raise exception 'sin sesión' using errcode = '42501'; end if;
  s := u.raw_user_meta_data -> 'signup';
  if s is null or exists (select 1 from public.admins where user_id = u.id) then return jsonb_build_object('created', false); end if;
  if u.email_confirmed_at is null then raise exception 'Confirme su correo antes de continuar'; end if;
  if coalesce(s ->> 'terms_version', '') = '' then raise exception 'Debe aceptar los términos'; end if;
  v_org := private.create_org(s ->> 'org_name', upper(s ->> 'country'), 'app_signup', false, s ->> 'terms_version');
  insert into public.admins (user_id, display_name, email) values (u.id, coalesce(nullif(trim(s ->> 'admin_name'), ''), u.email), lower(u.email));
  insert into public.admin_role_grants (user_id, role, organization_id, granted_by) values (u.id, 'central_admin', v_org, u.id);
  insert into public.audit_log (organization_id, actor, actor_kind, action, entity, entity_id, after)
  values (v_org, u.id, 'admin', 'org_signup', 'organizations', v_org::text, jsonb_build_object('terms_version', s ->> 'terms_version'));
  return jsonb_build_object('created', true, 'organizationId', v_org);
end $$;

revoke all on function private.tier_max(int), private.tier_label(int), private.org_access(uuid), private.enroll_limit(uuid), private.enrolled_count(uuid),
  private.support_active(uuid), private.is_org_admin(uuid), private.flag_inactive_org_event(), private.purge_org(uuid), private.purge_due_orgs(),
  private.country_tz(text), private.country_name(text), private.create_org(text, text, text, boolean, text) from public;
revoke execute on function public.org_plan_status(uuid), public.grant_support_access(uuid, int, text), public.revoke_support_access(uuid),
  public.request_org_deletion(uuid, text), public.cancel_org_deletion(uuid), public.platform_orgs(), public.platform_set_plan(uuid, boolean, int, timestamptz),
  public.platform_set_status(uuid, text, text), public.platform_create_own_org(text, text), public.complete_signup() from public, anon;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function private.org_access(uuid), private.enroll_limit(uuid), private.enrolled_count(uuid), private.support_active(uuid),
      private.is_org_admin(uuid), private.tier_max(int), private.tier_label(int) to authenticated';
    execute 'grant execute on function public.org_plan_status(uuid), public.grant_support_access(uuid, int, text), public.revoke_support_access(uuid),
      public.request_org_deletion(uuid, text), public.cancel_org_deletion(uuid), public.platform_orgs(), public.platform_set_plan(uuid, boolean, int, timestamptz),
      public.platform_set_status(uuid, text, text), public.platform_create_own_org(text, text), public.complete_signup() to authenticated';
    execute 'grant select on public.support_access to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on all functions in schema private to service_role';
    execute 'grant all on public.support_access to service_role';
  end if;
end $$;
notify pgrst, 'reload schema';
