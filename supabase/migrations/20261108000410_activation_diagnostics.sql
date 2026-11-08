-- Diagnóstico de activaciones fallidas: registra la longitud del código recibido (nunca su valor).
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
    -- Solo metadatos para diagnóstico (nunca el código): longitud recibida y normalizada.
    insert into public.security_events (kind, details) values ('activation_failed', jsonb_build_object(
      'reason', 'invalid_or_expired_code', 'normalized_length', length(v_norm), 'raw_length', length(coalesce(p_code, ''))));
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
