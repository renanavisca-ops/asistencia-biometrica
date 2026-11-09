-- Permiso de enrolamiento por teléfono (revocable en el panel) e invitación de administradores.
-- El enrolamiento exige: administrador con MFA + teléfono activo con «Puede enrolar». El teléfono pide una autorización
-- de un solo uso firmada con su clave (device-api /enroll-ticket); el administrador la liga a su sesión (bind_enroll_ticket).

alter table public.devices add column if not exists can_enroll boolean not null default false;
comment on column public.devices.can_enroll is 'El teléfono puede usar el modo enrolamiento (revocable en el panel; efecto inmediato en el servidor).';

create table if not exists private.enroll_tickets (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  ticket_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  bound_user uuid,
  bound_at timestamptz,
  revoked_at timestamptz
);
create index if not exists enroll_tickets_user on private.enroll_tickets (bound_user, bound_at desc);
alter table private.enroll_tickets enable row level security; -- sin políticas: solo funciones definer

-- Emitida por device-api tras verificar la firma del teléfono. null si el teléfono no tiene permiso.
create or replace function private.issue_enroll_ticket(p_device_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_dev public.devices%rowtype; v_ticket text;
begin
  select * into v_dev from public.devices where id = p_device_id;
  if not found or v_dev.status <> 'active' or not v_dev.can_enroll then return null; end if;
  v_ticket := encode(extensions.gen_random_bytes(24), 'hex');
  insert into private.enroll_tickets (device_id, ticket_hash, expires_at)
  values (p_device_id, encode(extensions.digest(v_ticket, 'sha256'), 'hex'), now() + interval '15 minutes');
  return v_ticket;
end $$;

-- El administrador (con MFA) liga la autorización del teléfono a su sesión. Devuelve el nombre del teléfono.
create or replace function public.bind_enroll_ticket(p_ticket text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_t private.enroll_tickets%rowtype; v_dev public.devices%rowtype;
begin
  select * into v_t from private.enroll_tickets where ticket_hash = encode(extensions.digest(coalesce(p_ticket, ''), 'sha256'), 'hex') for update;
  if not found or v_t.revoked_at is not null or v_t.bound_user is not null or v_t.expires_at < now() then
    raise exception 'autorización del teléfono no válida o caducada; cierre y vuelva a abrir el enrolamiento' using errcode = '42501';
  end if;
  select * into v_dev from public.devices where id = v_t.device_id;
  if v_dev.status <> 'active' or not v_dev.can_enroll then
    raise exception 'este teléfono no tiene permiso de enrolamiento' using errcode = '42501';
  end if;
  if not private.has_org_perm('enrollment.manage', v_dev.organization_id) then
    raise exception 'su cuenta no puede enrolar en la organización de este teléfono' using errcode = '42501';
  end if;
  update private.enroll_tickets set bound_user = auth.uid(), bound_at = now() where id = v_t.id;
  insert into public.audit_log (organization_id, actor, actor_kind, action, entity, entity_id)
  values (v_dev.organization_id, auth.uid(), 'admin', 'enroll_session_start', 'devices', v_dev.id::text);
  return v_dev.label;
end $$;

-- Activar/retirar el permiso desde el panel. Al retirarlo se invalidan las sesiones de enrolamiento abiertas.
create or replace function public.set_device_can_enroll(p_device_id uuid, p_allowed boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_dev public.devices%rowtype;
begin
  select * into v_dev from public.devices where id = p_device_id for update;
  if not found or not private.has_org_perm('device.manage', v_dev.organization_id) then raise exception 'permiso denegado' using errcode = '42501'; end if;
  update public.devices set can_enroll = coalesce(p_allowed, false) where id = p_device_id;
  if not coalesce(p_allowed, false) then
    update private.enroll_tickets set revoked_at = now() where device_id = p_device_id and revoked_at is null;
  end if;
end $$;

create or replace function public.enroll_biometric(
  p_employee_id uuid, p_consent_id uuid, p_store_id uuid, p_identity_method text,
  p_samples text[], p_quality jsonb, p_pad_passed boolean, p_pad_score real,
  p_recognition_model_id uuid, p_pad_model_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_emp public.employees%rowtype; v_model public.model_versions%rowtype; v_enr uuid := gen_random_uuid();
  s text; v_bytes bytea; v_key text; v_ver uuid;
begin
  select * into v_emp from public.employees where id = p_employee_id;
  if not found or not private.has_org_perm('enrollment.manage', v_emp.organization_id) then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  if v_emp.status <> 'active' then raise exception 'empleado no activo'; end if;
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
                                 'canEnroll', v_dev.can_enroll));
end $$;

-- ---------- Invitación de administradores (Edge Function admin-invite) ----------
-- Comprobación de permisos con la sesión de quien invita (MFA incluida).
create or replace function public.can_invite_admin(p_org uuid, p_role public.role_code) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when p_role = 'superadmin' then private.is_superadmin() else private.has_org_perm('admin.manage', p_org) end;
$$;

-- Alta del administrador invitado (solo service_role, desde admin-invite, tras crear el usuario en Auth).
create or replace function private.register_invited_admin(p_user_id uuid, p_name text, p_email text, p_role public.role_code, p_org uuid, p_invited_by uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if length(coalesce(trim(p_name), '')) < 2 then raise exception 'nombre requerido'; end if;
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

revoke all on function private.issue_enroll_ticket(uuid), private.register_invited_admin(uuid, text, text, public.role_code, uuid, uuid) from public;
revoke execute on function public.bind_enroll_ticket(text), public.set_device_can_enroll(uuid, boolean), public.can_invite_admin(uuid, public.role_code) from public, anon;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.bind_enroll_ticket(text), public.set_device_can_enroll(uuid, boolean), public.can_invite_admin(uuid, public.role_code) to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function private.issue_enroll_ticket(uuid), private.register_invited_admin(uuid, text, text, public.role_code, uuid, uuid), private.device_pull(uuid, uuid[]) to service_role';
    execute 'grant all on private.enroll_tickets to service_role';
  end if;
end $$;
notify pgrst, 'reload schema';
