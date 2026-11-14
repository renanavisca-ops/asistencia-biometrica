-- Un teléfono bloqueado (por error o recuperado) se puede reactivar emitiendo un código nuevo: queda «pendiente» hasta
-- que se active con ese código. Antes era imposible y había que registrar otro teléfono.
create or replace function public.issue_device_activation_code(p_device_id uuid, p_ttl_minutes int default 30)
returns text language plpgsql security definer set search_path = '' as $$
declare v_dev public.devices%rowtype; v_code text := ''; v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; i int;
begin
  select * into v_dev from public.devices where id = p_device_id;
  if not found or not private.has_org_perm('device.manage', v_dev.organization_id) then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  if v_dev.status = 'retired' then raise exception 'dispositivo retirado: registre un teléfono nuevo' using errcode = '23514'; end if;
  -- Reactivar un teléfono bloqueado: vuelve a «pendiente» y solo funcionará cuando se active con este código
  -- (sus credenciales anteriores ya fueron revocadas al bloquearlo).
  if v_dev.status = 'blocked' then
    update public.devices set status = 'pending', blocked_reason = null where id = p_device_id;
    insert into public.audit_log (organization_id, actor, actor_kind, action, entity, entity_id)
    values (v_dev.organization_id, auth.uid(), 'admin', 'reactivate_device', 'devices', p_device_id::text);
  end if;
  if p_ttl_minutes not between 5 and 1440 then raise exception 'ttl fuera de rango'; end if;
  for i in 1..12 loop
    v_code := v_code || substr(v_alphabet, 1 + (get_byte(extensions.gen_random_bytes(1), 0) % length(v_alphabet)), 1);
  end loop;
  update public.device_enrollments set expires_at = now() where device_id = p_device_id and used_at is null and expires_at > now();
  insert into public.device_enrollments (organization_id, device_id, code_hash, expires_at, created_by)
  values (v_dev.organization_id, p_device_id, encode(extensions.digest(v_code, 'sha256'), 'hex'),
          now() + make_interval(mins => p_ttl_minutes), auth.uid());
  insert into public.audit_log (organization_id, actor, actor_kind, action, entity, entity_id)
  values (v_dev.organization_id, auth.uid(), 'admin', 'issue_activation_code', 'devices', p_device_id::text);
  return substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-' || substr(v_code, 9, 4);
end $$;
