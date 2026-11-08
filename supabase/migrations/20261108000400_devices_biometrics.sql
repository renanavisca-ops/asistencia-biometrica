-- =====================================================================================
-- Dispositivos (activación, desafíos), enrolamiento biométrico central y descarga del roster.
-- Las plantillas se cifran dentro de Postgres (pgp_sym_encrypt AES-256) con una clave guardada
-- en Supabase Vault ('template_enc_key'); la clave nunca sale de la base de datos.
-- =====================================================================================

create or replace function private.template_key() returns text
language plpgsql stable security definer set search_path = '' as $$
declare k text;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'template_enc_key' limit 1;
  if k is null or length(k) < 32 then raise exception 'template_enc_key no configurada en Vault'; end if;
  return k;
end $$;

-- ---------- Enrolamiento central (llamado por administradores con enrollment.manage + MFA) ----------
create or replace function public.enroll_biometric(
  p_employee_id uuid, p_consent_id uuid, p_store_id uuid, p_identity_method text,
  p_samples text[], p_quality jsonb, p_pad_passed boolean, p_pad_score real,
  p_recognition_model_id uuid, p_pad_model_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_emp public.employees%rowtype; v_model public.model_versions%rowtype; v_enr uuid := gen_random_uuid();
  s text; v_bytes bytea; v_key text;
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

-- ---------- Activación de dispositivo (Edge Function device-api, sin JWT) ----------
create or replace function private.activate_device(
  p_code text, p_public_key text, p_platform text, p_os_version text, p_app_version text, p_hardware text, p_key_storage text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_enr public.device_enrollments%rowtype; v_dev public.devices%rowtype; v_store public.stores%rowtype; v_norm text;
begin
  -- Freno global ante fuerza bruta.
  if (select count(*) from public.security_events where kind = 'activation_failed' and created_at > now() - interval '10 minutes') > 50 then
    raise exception 'activation_throttled' using errcode = '42501';
  end if;
  v_norm := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  select * into v_enr from public.device_enrollments
   where code_hash = encode(extensions.digest(v_norm, 'sha256'), 'hex') and used_at is null and expires_at > now()
   for update;
  if not found then
    insert into public.security_events (kind, details) values ('activation_failed', jsonb_build_object('reason', 'invalid_or_expired_code'));
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;
  if p_public_key !~ '^[A-Za-z0-9_-]{43}$' then return jsonb_build_object('ok', false, 'error', 'invalid_public_key'); end if;
  if p_platform not in ('android', 'ios') then return jsonb_build_object('ok', false, 'error', 'invalid_platform'); end if;
  select * into v_dev from public.devices where id = v_enr.device_id for update;
  if v_dev.status in ('blocked', 'retired') then return jsonb_build_object('ok', false, 'error', 'device_blocked'); end if;

  update public.device_enrollments set used_at = now() where id = v_enr.id;
  -- Reinstalación/sustitución: la credencial anterior queda revocada (no hay dos teléfonos con la misma identidad).
  update public.device_credentials set revoked_at = now(), revoked_reason = 'reactivación con código'
   where device_id = v_dev.id and revoked_at is null;
  insert into public.device_credentials (organization_id, device_id, public_key, key_storage)
  values (v_dev.organization_id, v_dev.id, p_public_key, p_key_storage);
  update public.devices set status = 'active', activated_at = now(), platform = p_platform, os_version = p_os_version,
         app_version = p_app_version, hardware_model = p_hardware, last_seen_at = now()
   where id = v_dev.id;
  insert into public.audit_log (organization_id, actor_kind, action, entity, entity_id, after)
  values (v_dev.organization_id, 'device', 'device_activated', 'devices', v_dev.id::text,
          jsonb_build_object('platform', p_platform, 'hardware', p_hardware, 'key_storage', p_key_storage));
  select * into v_store from public.stores where id = v_dev.store_id;
  return jsonb_build_object('ok', true, 'deviceId', v_dev.id, 'organizationId', v_dev.organization_id,
    'storeId', v_store.id, 'storeName', v_store.name, 'timezone', v_store.timezone,
    -- La app continúa la secuencia: tras una reinstalación nunca reutiliza números ya confirmados.
    'nextDeviceSeq', v_dev.last_device_seq + 1, 'serverTime', now());
end $$;

-- ---------- Desafíos de autenticación (vida corta, un solo uso) ----------
create or replace function private.issue_challenge(p_device_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  if not exists (select 1 from public.devices where id = p_device_id and status = 'active') then return null; end if;
  delete from private.device_challenges where created_at < now() - interval '10 minutes';
  v := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  insert into private.device_challenges (challenge, device_id) values (v, p_device_id);
  return v;
end $$;

-- Consume el desafío y devuelve la clave pública activa (o null). La verificación de la firma la hace la Edge Function.
create or replace function private.consume_challenge(p_device_id uuid, p_challenge text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_ok boolean;
begin
  update private.device_challenges set used_at = now()
   where challenge = p_challenge and device_id = p_device_id and used_at is null and created_at > now() - interval '2 minutes'
  returning true into v_ok;
  if v_ok is not true then return null; end if;
  return (select c.public_key from public.device_credentials c join public.devices d on d.id = c.device_id
          where c.device_id = p_device_id and c.revoked_at is null and d.status = 'active');
end $$;

create or replace function private.record_device_health(p_device_id uuid, p_health jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.device_health (organization_id, device_id, pending_events, battery_pct, free_storage_mb, app_version, os_version,
                                    recognition_model, pad_model, clock_offset_ms, flags)
  select d.organization_id, d.id, (p_health ->> 'pendingEvents')::int, (p_health ->> 'batteryPct')::int,
         (p_health ->> 'freeStorageMb')::int, left(p_health ->> 'appVersion', 40), left(p_health ->> 'osVersion', 60),
         left(p_health ->> 'recognitionModel', 80), left(p_health ->> 'padModel', 80), (p_health ->> 'clockOffsetMs')::bigint,
         coalesce(array(select left(x, 60) from jsonb_array_elements_text(coalesce(p_health -> 'flags', '[]')) x limit 20), '{}')
  from public.devices d where d.id = p_device_id;
  update public.devices set last_seen_at = now(), app_version = coalesce(left(p_health ->> 'appVersion', 40), app_version)
   where id = p_device_id;
end $$;

-- ---------- Descarga para el dispositivo: política, roster con plantillas y revocaciones ----------
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
    -- Dispositivo bloqueado: se ordena borrar todo lo local.
    return jsonb_build_object('serverTime', now(), 'policy', v_policy, 'rosterVersion', null, 'roster', '[]'::jsonb,
      'revokedEmployeeIds', to_jsonb(coalesce(p_known_employee_ids, '{}')),
      'device', jsonb_build_object('status', v_dev.status, 'storeId', v_store.id, 'storeName', v_store.name, 'timezone', v_store.timezone));
  end if;

  v_key := private.template_key();
  select coalesce(jsonb_agg(jsonb_build_object(
           'employeeId', r.employee_id, 'displayName', r.display_name, 'leaseExpiresAt', r.lease_expires_at,
           'lastEvent', case when r.last_event_id is null then null else
              jsonb_build_object('id', r.last_event_id, 'eventType', r.last_event_type, 'occurredAt', r.last_event_at) end,
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
    'device', jsonb_build_object('status', v_dev.status, 'storeId', v_store.id, 'storeName', v_store.name, 'timezone', v_store.timezone));
end $$;

revoke all on all functions in schema private from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.enroll_biometric(uuid, uuid, uuid, text, text[], jsonb, boolean, real, uuid, uuid) to authenticated';
    execute 'grant execute on function private.admin_session_ok(), private.is_superadmin(), private.has_org_perm(text, uuid),
      private.has_store_perm(text, uuid), private.store_ids_with(text), private.is_org_member(uuid), private.can_see_employee(text, uuid),
      private.actor() to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on all functions in schema private to service_role';
  end if;
end $$;
revoke execute on function public.enroll_biometric(uuid, uuid, uuid, text, text[], jsonb, boolean, real, uuid, uuid) from public;
