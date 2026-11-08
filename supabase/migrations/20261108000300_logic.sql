-- =====================================================================================
-- Lógica de servidor: auditoría, inmutabilidad, ingesta de eventos, proyección de sesiones,
-- incidencias y RPC administrativos con trazabilidad.
-- =====================================================================================

-- ---------- Utilidades ----------
create or replace function private.actor() returns uuid language sql stable set search_path = '' as $$
  select coalesce(auth.uid(), nullif(current_setting('app.actor', true), '')::uuid);
$$;

create or replace function private.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger trg_touch before update on public.employees for each row execute function private.touch_updated_at();
create trigger trg_touch before update on public.stores for each row execute function private.touch_updated_at();

-- organization_id inmutable en todas las tablas que lo tienen.
create or replace function private.immutable_org() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'organization_id es inmutable' using errcode = '42501';
  end if;
  return new;
end $$;

-- Tablas append-only: sin UPDATE ni DELETE salvo purga de retención explícita.
create or replace function private.append_only() returns trigger language plpgsql set search_path = '' as $$
begin
  if current_setting('app.retention_purge', true) = 'on' and tg_op = 'DELETE' then return old; end if;
  raise exception 'La tabla % es de solo inserción', tg_table_name using errcode = '42501';
end $$;

do $$ declare t text; begin
  foreach t in array array['attendance_events','attendance_corrections','audit_log','security_events',
                           'employee_status_history','sync_acknowledgements'] loop
    execute format('create trigger trg_append_only before update or delete on public.%I for each row execute function private.append_only()', t);
  end loop;
  foreach t in array array['regions','stores','employees','employee_store_assignments','devices','device_credentials',
                           'biometric_consents','biometric_enrollments','incidents','retention_requests','device_policy_versions'] loop
    execute format('create trigger trg_immutable_org before update on public.%I for each row execute function private.immutable_org()', t);
  end loop;
end $$;

-- Auditoría genérica.
create or replace function private.audit() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_row jsonb;
begin
  v_row := to_jsonb(coalesce(new, old));
  v_org := nullif(v_row ->> 'organization_id', '')::uuid;
  if tg_table_name = 'organizations' then v_org := (v_row ->> 'id')::uuid; end if;
  insert into public.audit_log (organization_id, actor, actor_kind, action, entity, entity_id, before, after)
  values (v_org, private.actor(), case when private.actor() is null then 'system' else 'admin' end,
          lower(tg_op), tg_table_name, coalesce(v_row ->> 'id', v_row ->> 'user_id'),
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

do $$ declare t text; begin
  foreach t in array array['organizations','regions','stores','employees','employee_store_assignments','admins',
                           'admin_role_grants','devices','device_credentials','device_policy_versions','model_versions',
                           'liveness_policy_versions','biometric_consents','biometric_enrollments','attendance_corrections',
                           'incidents','retention_requests'] loop
    execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function private.audit()', t);
  end loop;
end $$;

-- Historial de estado laboral (AFTER, para respetar la FK); una baja revoca asignaciones vigentes (BEFORE).
create or replace function private.employee_status_history_log() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.employee_status_history (organization_id, employee_id, from_status, to_status, reason, changed_by)
    values (new.organization_id, new.id, case when tg_op = 'UPDATE' then old.status end, new.status,
            nullif(current_setting('app.reason', true), ''), private.actor());
  end if;
  return null;
end $$;
create trigger trg_employee_status_history after insert or update of status on public.employees
  for each row execute function private.employee_status_history_log();

create or replace function private.employee_termination() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'terminated' and old.status <> 'terminated' then
    update public.employee_store_assignments set revoked_at = now(), revoked_by = private.actor(),
           reason = coalesce(reason, 'baja del empleado')
     where employee_id = new.id and revoked_at is null;
    new.terminated_on := coalesce(new.terminated_on, current_date);
  end if;
  return new;
end $$;
create trigger trg_employee_termination before update of status on public.employees
  for each row execute function private.employee_termination();

-- Asignaciones: la tienda debe estar activa; impedir solapes de asignaciones permanentes.
create or replace function private.assignment_check() returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.stores s where s.id = new.store_id and s.status <> 'active') then
    raise exception 'La tienda no está activa' using errcode = '23514';
  end if;
  if exists (select 1 from public.employees e where e.id = new.employee_id and e.status = 'terminated') then
    raise exception 'El empleado está dado de baja' using errcode = '23514';
  end if;
  if new.kind = 'permanent' and new.revoked_at is null and exists (
      select 1 from public.employee_store_assignments a
      where a.employee_id = new.employee_id and a.id <> new.id and a.kind = 'permanent' and a.revoked_at is null
        and tstzrange(a.valid_from, a.valid_to) && tstzrange(new.valid_from, new.valid_to)) then
    raise exception 'Ya existe una asignación permanente vigente en ese periodo; use transfer_employee' using errcode = '23P01';
  end if;
  return new;
end $$;
create trigger trg_assignment_check before insert on public.employee_store_assignments
  for each row execute function private.assignment_check();

-- ---------- Eventos efectivos ----------
-- Un evento es efectivo si no fue rechazado ni anulado por una corrección.
create or replace view public.attendance_events_effective with (security_invoker = true) as
select e.*,
       case when e.status = 'needs_review' and exists (
              select 1 from public.attendance_corrections c where c.target_event_id = e.id and c.kind = 'confirm')
            then 'accepted'::public.event_status else e.status end as effective_status
from public.attendance_events e
where e.status <> 'rejected'
  and not exists (select 1 from public.attendance_corrections c where c.target_event_id = e.id and c.kind = 'void');

-- ---------- Incidencias ----------
create or replace function private.open_incident(
  p_org uuid, p_kind public.incident_kind, p_dedup text, p_store uuid, p_employee uuid, p_device uuid,
  p_events uuid[], p_details jsonb, p_severity text default 'medium'
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.incidents (organization_id, kind, dedup_key, store_id, employee_id, device_id, event_ids, details, severity)
  values (p_org, p_kind, p_dedup, p_store, p_employee, p_device, coalesce(p_events, '{}'), coalesce(p_details, '{}'), p_severity)
  on conflict (dedup_key) where status = 'open' and dedup_key is not null do nothing
  returning id into v_id;
  return v_id;
end $$;

-- ---------- Proyección de sesiones (equivalente a packages/core/src/sessions.ts) ----------
create or replace function private.rebuild_sessions(p_employee uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record; v_open record; v_has_open boolean := false; v_org uuid;
  v_review boolean;
begin
  select organization_id into v_org from public.employees where id = p_employee;
  delete from public.attendance_sessions where employee_id = p_employee;
  for r in
    select id, store_id, event_type, occurred_at, effective_status
    from public.attendance_events_effective where employee_id = p_employee
    order by occurred_at, id
  loop
    if r.event_type = 'IN' then
      if v_has_open then
        insert into public.attendance_sessions (organization_id, employee_id, store_id, in_event_id, opened_at, state, needs_review)
        values (v_org, p_employee, v_open.store_id, v_open.id, v_open.occurred_at, 'missing_out', true);
        perform private.open_incident(v_org, 'missing_out', 'missing_out:' || v_open.id, v_open.store_id, p_employee, null,
                                      array[v_open.id, r.id], jsonb_build_object('next_in_at', r.occurred_at));
      end if;
      v_open := r; v_has_open := true;
    elsif v_has_open then
      v_review := v_open.effective_status = 'needs_review' or r.effective_status = 'needs_review' or v_open.store_id <> r.store_id;
      insert into public.attendance_sessions (organization_id, employee_id, store_id, in_event_id, out_event_id, opened_at, closed_at, state, cross_store, needs_review)
      values (v_org, p_employee, v_open.store_id, v_open.id, r.id, v_open.occurred_at, r.occurred_at, 'closed', v_open.store_id <> r.store_id, v_review);
      if v_open.store_id <> r.store_id then
        perform private.open_incident(v_org, 'cross_store_session', 'cross_store:' || v_open.id, r.store_id, p_employee, null,
                                      array[v_open.id, r.id], '{}'::jsonb, 'low');
      end if;
      v_has_open := false;
    else
      insert into public.attendance_sessions (organization_id, employee_id, store_id, out_event_id, closed_at, state, needs_review)
      values (v_org, p_employee, r.store_id, r.id, r.occurred_at, 'orphan_out', true);
      perform private.open_incident(v_org, 'orphan_out', 'orphan_out:' || r.id, r.store_id, p_employee, null, array[r.id], '{}'::jsonb);
    end if;
  end loop;
  if v_has_open then
    insert into public.attendance_sessions (organization_id, employee_id, store_id, in_event_id, opened_at, state, needs_review)
    values (v_org, p_employee, v_open.store_id, v_open.id, v_open.occurred_at, 'open', v_open.effective_status = 'needs_review');
  end if;
end $$;

-- Sesiones abiertas demasiado tiempo → incidencia (ejecutar periódicamente con pg_cron).
create or replace function private.flag_long_open_sessions(p_hours numeric default 16) returns int
language plpgsql security definer set search_path = '' as $$
declare n int := 0; r record;
begin
  for r in select * from public.attendance_sessions where state = 'open' and opened_at < now() - make_interval(secs => p_hours * 3600) loop
    if private.open_incident(r.organization_id, 'long_open_session', 'long_open:' || r.in_event_id, r.store_id, r.employee_id, null,
                             array[r.in_event_id], jsonb_build_object('opened_at', r.opened_at, 'threshold_hours', p_hours), 'low') is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- ---------- Ingesta de eventos de dispositivo ----------
-- Llamada SOLO por la Edge Function device-sync tras verificar la autenticación del dispositivo
-- y la firma Ed25519 de cada evento. p_events contiene únicamente eventos con firma válida;
-- p_invalid_ids los que fallaron la verificación (se rechazan y se registran como evento de seguridad).
create or replace function private.ingest_device_events(
  p_device_id uuid, p_batch_id uuid, p_events jsonb, p_invalid_ids uuid[] default '{}'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_dev public.devices%rowtype;
  v_store public.stores%rowtype;
  e jsonb; v_id uuid; v_emp uuid; v_type public.attendance_event_type; v_seq bigint; v_at timestamptz;
  v_status public.event_status; v_reasons text[]; v_existing public.attendance_events%rowtype;
  v_prev record; v_next record; v_emp_row public.employees%rowtype;
  v_acks jsonb := '[]'::jsonb; v_result text; v_reason text;
  v_affected uuid[] := '{}'; v_max_seq bigint; v_existing_batch public.sync_batches%rowtype;
  n_acc int := 0; n_dup int := 0; n_rev int := 0; n_rej int := 0; v_inv uuid;
begin
  select * into v_dev from public.devices where id = p_device_id for update;
  if not found or v_dev.status <> 'active' then
    raise exception 'device_not_active' using errcode = '42501';
  end if;
  select * into v_store from public.stores where id = v_dev.store_id;

  -- Idempotencia por lote: si ya se procesó, devolver los mismos acuses.
  select * into v_existing_batch from public.sync_batches where id = p_batch_id;
  if found then
    if v_existing_batch.device_id <> p_device_id then raise exception 'batch_id_conflict' using errcode = '42501'; end if;
    return (select coalesce(jsonb_agg(jsonb_build_object('eventId', event_id, 'result', result, 'reason', reason)), '[]'::jsonb)
            from public.sync_acknowledgements where batch_id = p_batch_id);
  end if;

  insert into public.sync_batches (id, organization_id, device_id, event_count)
  values (p_batch_id, v_dev.organization_id, p_device_id, jsonb_array_length(p_events) + coalesce(array_length(p_invalid_ids, 1), 0));

  foreach v_inv in array coalesce(p_invalid_ids, '{}') loop
    insert into public.sync_acknowledgements values (p_batch_id, v_inv, 'rejected', 'signature_invalid') on conflict do nothing;
    insert into public.security_events (organization_id, device_id, kind, details)
    values (v_dev.organization_id, p_device_id, 'event_signature_invalid', jsonb_build_object('event_id', v_inv, 'batch_id', p_batch_id));
    n_rej := n_rej + 1;
  end loop;

  v_max_seq := v_dev.last_device_seq;

  for e in select value from jsonb_array_elements(p_events) order by (value ->> 'deviceSeq')::bigint loop
    v_id := (e ->> 'id')::uuid; v_emp := (e ->> 'employeeId')::uuid; v_type := (e ->> 'eventType')::public.attendance_event_type;
    v_seq := (e ->> 'deviceSeq')::bigint; v_at := (e ->> 'occurredAt')::timestamptz;
    v_status := 'accepted'; v_reasons := '{}'; v_result := null; v_reason := null;

    -- 1. Duplicado exacto (reintento).
    select * into v_existing from public.attendance_events where id = v_id;
    if found then
      if v_existing.device_id = p_device_id and v_existing.device_seq = v_seq then
        v_result := 'duplicate';
      else
        v_result := 'rejected'; v_reason := 'id_conflict';
      end if;
    end if;

    -- 2. Secuencia reutilizada con otro id → posible clonación o reinstalación no administrada.
    if v_result is null and exists (select 1 from public.attendance_events where device_id = p_device_id and device_seq = v_seq) then
      v_result := 'rejected'; v_reason := 'sequence_conflict';
      insert into public.security_events (organization_id, device_id, kind, details)
      values (v_dev.organization_id, p_device_id, 'sequence_conflict', jsonb_build_object('event_id', v_id, 'device_seq', v_seq));
      perform private.open_incident(v_dev.organization_id, 'sequence_conflict', 'seqc:' || p_device_id || ':' || v_seq,
                                    v_dev.store_id, null, p_device_id, array[v_id], jsonb_build_object('device_seq', v_seq), 'high');
    end if;

    -- 3. Empleado de otra organización o inexistente → rechazo (no se confía en el cliente).
    if v_result is null then
      select * into v_emp_row from public.employees where id = v_emp and organization_id = v_dev.organization_id;
      if not found then
        v_result := 'rejected'; v_reason := 'unknown_employee';
        insert into public.security_events (organization_id, device_id, kind, details)
        values (v_dev.organization_id, p_device_id, 'unknown_employee', jsonb_build_object('event_id', v_id));
      end if;
    end if;

    if v_result is null then
      -- 4. Validaciones que envían a revisión sin perder el evento.
      if (e ->> 'storeId')::uuid is distinct from v_dev.store_id then v_reasons := array_append(v_reasons, 'store_mismatch'); end if;
      if v_emp_row.status <> 'active' then
        v_reasons := array_append(v_reasons, 'inactive_employee');
        perform private.open_incident(v_dev.organization_id, 'inactive_employee', 'inactive:' || v_id, v_dev.store_id, v_emp, p_device_id,
                                      array[v_id], jsonb_build_object('status', v_emp_row.status), 'high');
      end if;
      if not exists (select 1 from public.employee_store_assignments a
                     where a.employee_id = v_emp and a.store_id = v_dev.store_id
                       and a.valid_from <= v_at and (a.valid_to is null or a.valid_to > v_at)
                       and (a.revoked_at is null or a.revoked_at > v_at)) then
        v_reasons := array_append(v_reasons, 'unassigned_store');
        perform private.open_incident(v_dev.organization_id, 'unassigned_store', 'unassigned:' || v_id, v_dev.store_id, v_emp, p_device_id,
                                      array[v_id], '{}'::jsonb, 'high');
      end if;
      if jsonb_array_length(coalesce(e -> 'clockFlags', '[]')) > 0 or v_at > now() + interval '5 minutes'
         or v_at < coalesce(v_dev.activated_at, v_at) - interval '1 day' then
        v_reasons := array_append(v_reasons, 'clock_anomaly');
        perform private.open_incident(v_dev.organization_id, 'clock_anomaly', 'clock:' || v_id, v_dev.store_id, v_emp, p_device_id,
                                      array[v_id], jsonb_build_object('clock_flags', e -> 'clockFlags', 'occurred_at', v_at, 'received_at', now()));
      end if;
      if v_seq > v_max_seq + 1 then
        perform private.open_incident(v_dev.organization_id, 'sequence_gap', 'gap:' || p_device_id || ':' || v_max_seq, v_dev.store_id, null,
                                      p_device_id, array[v_id], jsonb_build_object('expected', v_max_seq + 1, 'received', v_seq), 'medium');
      end if;

      -- 5. Alternancia frente a otros eventos del empleado (otros dispositivos, sincronizaciones tardías).
      select id, event_type, device_id into v_prev from public.attendance_events_effective
       where employee_id = v_emp and (occurred_at, id) < (v_at, v_id) order by occurred_at desc, id desc limit 1;
      select id, event_type, device_id into v_next from public.attendance_events_effective
       where employee_id = v_emp and (occurred_at, id) > (v_at, v_id) order by occurred_at, id limit 1;
      if (v_prev.id is not null and v_prev.event_type = v_type and not (v_type = 'IN' and (e -> 'decisionFlags') ? 'stale_open_session'))
         or (v_next.id is not null and v_next.event_type = v_type) then
        v_reasons := array_append(v_reasons, 'sequence_inconsistent');
        perform private.open_incident(v_dev.organization_id,
          case when coalesce(v_prev.device_id, v_next.device_id) is distinct from p_device_id then 'offline_conflict' else 'duplicate' end::public.incident_kind,
          'alt:' || v_id, v_dev.store_id, v_emp, p_device_id, array_remove(array[v_prev.id, v_id, v_next.id], null), '{}'::jsonb);
      end if;

      if array_length(v_reasons, 1) > 0 then v_status := 'needs_review'; end if;

      insert into public.attendance_events (
        id, organization_id, store_id, device_id, employee_id, event_type, source, status, review_reasons, device_seq,
        occurred_at, tz_offset_min, device_monotonic_ms, device_boot_id, last_server_time, est_clock_offset_ms, clock_flags,
        decision_flags, captured_offline, match_score, match_margin, pad_score, recognition_model, pad_model, policy_version,
        app_version, signature, payload_hash, sync_batch_id)
      values (
        v_id, v_dev.organization_id, v_dev.store_id, p_device_id, v_emp, v_type, 'biometric', v_status, v_reasons, v_seq,
        v_at, (e ->> 'tzOffsetMin')::int, (e ->> 'monotonicMs')::bigint, e ->> 'bootId', (e ->> 'lastServerTime')::timestamptz,
        (e ->> 'estClockOffsetMs')::bigint,
        coalesce(array(select jsonb_array_elements_text(e -> 'clockFlags')), '{}'),
        coalesce(array(select jsonb_array_elements_text(e -> 'decisionFlags')), '{}'),
        coalesce((e ->> 'capturedOffline')::boolean, false), (e ->> 'matchScore')::real, (e ->> 'matchMargin')::real,
        (e ->> 'padScore')::real, e ->> 'recognitionModel', e ->> 'padModel', (e ->> 'policyVersion')::int,
        e ->> 'appVersion', e ->> 'signature', e ->> 'payloadHash', p_batch_id);

      v_result := case when v_status = 'accepted' then 'accepted' else 'needs_review' end;
      v_reason := nullif(array_to_string(v_reasons, ','), '');
      v_affected := v_affected || v_emp;
      v_max_seq := greatest(v_max_seq, v_seq);
    end if;

    insert into public.sync_acknowledgements values (p_batch_id, v_id, v_result, v_reason) on conflict do nothing;
    case v_result when 'accepted' then n_acc := n_acc + 1; when 'duplicate' then n_dup := n_dup + 1;
                  when 'needs_review' then n_rev := n_rev + 1; else n_rej := n_rej + 1; end case;
    v_acks := v_acks || jsonb_build_object('eventId', v_id, 'result', v_result, 'reason', v_reason);
  end loop;

  update public.devices set last_device_seq = v_max_seq, last_sync_at = now(), last_seen_at = now() where id = p_device_id;
  update public.sync_batches set accepted_count = n_acc, duplicate_count = n_dup, review_count = n_rev, rejected_count = n_rej
   where id = p_batch_id;

  perform private.rebuild_sessions(x) from (select distinct unnest(v_affected) x) s;
  return v_acks;
end $$;

-- ---------- Lista autorizada (roster) para un dispositivo ----------
create or replace function private.device_roster(p_device_id uuid, p_lease_hours int)
returns table (employee_id uuid, display_name text, lease_expires_at timestamptz,
               last_event_id uuid, last_event_type public.attendance_event_type, last_event_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select e.id, e.first_name || ' ' || left(e.last_name, 1) || '.',
         least(now() + make_interval(hours => p_lease_hours), min(a.valid_to)),
         le.id, le.event_type, le.occurred_at
  from public.devices d
  join public.employee_store_assignments a on a.store_id = d.store_id and a.revoked_at is null
       and a.valid_from <= now() and (a.valid_to is null or a.valid_to > now())
  join public.employees e on e.id = a.employee_id and e.status = 'active'
  join public.biometric_enrollments be on be.employee_id = e.id and be.status = 'active'
  join public.biometric_consents c on c.id = be.consent_id and c.withdrawn_at is null
  left join lateral (select x.id, x.event_type, x.occurred_at from public.attendance_events_effective x
                     where x.employee_id = e.id order by x.occurred_at desc, x.id desc limit 1) le on true
  where d.id = p_device_id and d.status = 'active'
  group by e.id, e.first_name, e.last_name, le.id, le.event_type, le.occurred_at;
$$;

-- ---------- RPC administrativos (expuestos a authenticated, comprueban permisos) ----------

-- Código de activación de un solo uso para un dispositivo pendiente o a sustituir.
create or replace function public.issue_device_activation_code(p_device_id uuid, p_ttl_minutes int default 30)
returns text language plpgsql security definer set search_path = '' as $$
declare v_dev public.devices%rowtype; v_code text := ''; v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; i int;
begin
  select * into v_dev from public.devices where id = p_device_id;
  if not found or not private.has_org_perm('device.manage', v_dev.organization_id) then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  if v_dev.status in ('blocked', 'retired') then raise exception 'dispositivo bloqueado o retirado' using errcode = '23514'; end if;
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

create or replace function public.set_device_status(p_device_id uuid, p_status public.device_status, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_dev public.devices%rowtype;
begin
  select * into v_dev from public.devices where id = p_device_id for update;
  if not found or not private.has_org_perm('device.manage', v_dev.organization_id) then raise exception 'permiso denegado' using errcode = '42501'; end if;
  if p_status not in ('blocked', 'retired', 'active') then raise exception 'estado no permitido'; end if;
  if p_status = 'active' and not exists (select 1 from public.device_credentials where device_id = p_device_id and revoked_at is null) then
    raise exception 'el dispositivo debe reactivarse con un código'; end if;
  if length(coalesce(trim(p_reason), '')) < 5 then raise exception 'motivo requerido'; end if;
  update public.devices set status = p_status, blocked_reason = case when p_status = 'active' then null else p_reason end where id = p_device_id;
  if p_status in ('blocked', 'retired') then
    update public.device_credentials set revoked_at = now(), revoked_reason = p_reason where device_id = p_device_id and revoked_at is null;
  end if;
end $$;

create or replace function public.transfer_employee(
  p_employee_id uuid, p_to_store_id uuid, p_kind text, p_valid_from timestamptz, p_valid_to timestamptz, p_reason text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_emp public.employees%rowtype; v_id uuid;
begin
  select * into v_emp from public.employees where id = p_employee_id;
  if not found or not private.has_org_perm('assignment.manage', v_emp.organization_id) then raise exception 'permiso denegado' using errcode = '42501'; end if;
  if length(coalesce(trim(p_reason), '')) < 5 then raise exception 'motivo requerido'; end if;
  if p_kind = 'permanent' then
    -- Cierra la asignación permanente vigente en la fecha efectiva (no la borra).
    update public.employee_store_assignments set valid_to = coalesce(p_valid_from, now())
     where employee_id = p_employee_id and kind = 'permanent' and revoked_at is null
       and (valid_to is null or valid_to > coalesce(p_valid_from, now())) and valid_from < coalesce(p_valid_from, now());
    update public.employee_store_assignments set revoked_at = now(), revoked_by = auth.uid(), reason = 'reemplazada por traslado'
     where employee_id = p_employee_id and kind = 'permanent' and revoked_at is null and valid_from >= coalesce(p_valid_from, now());
  end if;
  insert into public.employee_store_assignments (organization_id, employee_id, store_id, kind, valid_from, valid_to, reason, created_by)
  values (v_emp.organization_id, p_employee_id, p_to_store_id, p_kind, coalesce(p_valid_from, now()), p_valid_to, p_reason, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.revoke_assignment(p_assignment_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_a public.employee_store_assignments%rowtype;
begin
  select * into v_a from public.employee_store_assignments where id = p_assignment_id for update;
  if not found or not private.has_org_perm('assignment.manage', v_a.organization_id) then raise exception 'permiso denegado' using errcode = '42501'; end if;
  if length(coalesce(trim(p_reason), '')) < 5 then raise exception 'motivo requerido'; end if;
  update public.employee_store_assignments set revoked_at = now(), revoked_by = auth.uid(), reason = p_reason where id = p_assignment_id and revoked_at is null;
end $$;

create or replace function public.set_employee_status(p_employee_id uuid, p_status public.employee_status, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_emp public.employees%rowtype;
begin
  select * into v_emp from public.employees where id = p_employee_id for update;
  if not found or not private.has_org_perm('employee.manage', v_emp.organization_id) then raise exception 'permiso denegado' using errcode = '42501'; end if;
  if length(coalesce(trim(p_reason), '')) < 5 then raise exception 'motivo requerido'; end if;
  perform set_config('app.reason', p_reason, true);
  update public.employees set status = p_status where id = p_employee_id;
end $$;

-- Corrección auditada: confirma, anula o añade un evento; nunca modifica el original.
create or replace function public.correct_attendance(
  p_kind text, p_employee_id uuid, p_reason text, p_target_event_id uuid default null,
  p_event_type public.attendance_event_type default null, p_occurred_at timestamptz default null,
  p_store_id uuid default null, p_incident_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_emp public.employees%rowtype; v_target public.attendance_events%rowtype; v_corr uuid := gen_random_uuid(); v_new uuid;
begin
  select * into v_emp from public.employees where id = p_employee_id;
  if not found then raise exception 'empleado inexistente'; end if;
  if p_kind in ('confirm', 'void') then
    select * into v_target from public.attendance_events where id = p_target_event_id and employee_id = p_employee_id;
    if not found then raise exception 'evento inexistente'; end if;
    if not private.has_store_perm('attendance.correct', v_target.store_id) then raise exception 'permiso denegado' using errcode = '42501'; end if;
    if exists (select 1 from public.attendance_corrections where target_event_id = p_target_event_id and kind in ('confirm','void')) then
      raise exception 'el evento ya tiene una corrección; use una corrección nueva sobre el estado actual';
    end if;
    insert into public.attendance_corrections (id, organization_id, employee_id, kind, target_event_id, previous, reason, incident_id, actor)
    values (v_corr, v_emp.organization_id, p_employee_id, p_kind, p_target_event_id, to_jsonb(v_target), p_reason, p_incident_id, auth.uid());
  elsif p_kind = 'add' then
    if p_event_type is null or p_occurred_at is null or p_store_id is null then raise exception 'faltan datos del evento'; end if;
    if not private.has_store_perm('attendance.correct', p_store_id) then raise exception 'permiso denegado' using errcode = '42501'; end if;
    if p_occurred_at > now() then raise exception 'no se permiten eventos futuros'; end if;
    v_new := gen_random_uuid();
    set constraints all deferred;
    insert into public.attendance_corrections (id, organization_id, employee_id, kind, new_event_id, new_values, reason, incident_id, actor)
    values (v_corr, v_emp.organization_id, p_employee_id, 'add', v_new,
            jsonb_build_object('event_type', p_event_type, 'occurred_at', p_occurred_at, 'store_id', p_store_id), p_reason, p_incident_id, auth.uid());
    insert into public.attendance_events (id, organization_id, store_id, employee_id, event_type, source, status, review_reasons, occurred_at, correction_id)
    values (v_new, v_emp.organization_id, p_store_id, p_employee_id, p_event_type, 'admin_correction', 'accepted', '{}', p_occurred_at, v_corr);
  else
    raise exception 'tipo de corrección no válido';
  end if;
  perform private.rebuild_sessions(p_employee_id);
  return v_corr;
end $$;

create or replace function public.resolve_incident(p_incident_id uuid, p_status public.incident_status, p_resolution text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_i public.incidents%rowtype;
begin
  select * into v_i from public.incidents where id = p_incident_id for update;
  if not found then raise exception 'incidencia inexistente'; end if;
  if not (case when v_i.store_id is null then private.has_org_perm('incident.resolve', v_i.organization_id)
               else private.has_store_perm('incident.resolve', v_i.store_id) end) then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  if p_status = 'open' then raise exception 'estado no válido'; end if;
  if length(coalesce(trim(p_resolution), '')) < 10 then raise exception 'justificación requerida (mín. 10 caracteres)'; end if;
  update public.incidents set status = p_status, resolution = p_resolution, resolved_by = auth.uid(), resolved_at = now() where id = p_incident_id;
end $$;

create or replace function public.grant_role(p_user_id uuid, p_role public.role_code, p_org uuid, p_region uuid default null, p_store uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_role = 'superadmin' then
    if not private.is_superadmin() then raise exception 'permiso denegado' using errcode = '42501'; end if;
  elsif not private.has_org_perm('admin.manage', p_org) then raise exception 'permiso denegado' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then raise exception 'no puede modificar sus propios roles'; end if;
  insert into public.admin_role_grants (user_id, role, organization_id, region_id, store_id, granted_by)
  values (p_user_id, p_role, case when p_role = 'superadmin' then null else p_org end, p_region, p_store, auth.uid()) returning id into v_id;
  return v_id;
end $$;

create or replace function public.revoke_role(p_grant_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_g public.admin_role_grants%rowtype;
begin
  select * into v_g from public.admin_role_grants where id = p_grant_id for update;
  if not found then raise exception 'inexistente'; end if;
  if (v_g.role = 'superadmin' and not private.is_superadmin())
     or (v_g.role <> 'superadmin' and not private.has_org_perm('admin.manage', v_g.organization_id)) then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  if v_g.user_id = auth.uid() then raise exception 'no puede revocar sus propios roles'; end if;
  update public.admin_role_grants set revoked_at = now() where id = p_grant_id;
end $$;

-- Derechos del titular: decidir y ejecutar solicitudes (borrado de biometría, etc.).
create or replace function public.decide_retention_request(p_id uuid, p_approve boolean, p_notes text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.retention_requests%rowtype;
begin
  select * into v_r from public.retention_requests where id = p_id for update;
  if not found or not private.has_org_perm('privacy.manage', v_r.organization_id) then raise exception 'permiso denegado' using errcode = '42501'; end if;
  if v_r.status <> 'requested' then raise exception 'ya decidida'; end if;
  if v_r.requested_by = auth.uid() then raise exception 'separación de funciones: otra persona debe decidir'; end if;
  update public.retention_requests set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), notes = p_notes where id = p_id;
  if p_approve and v_r.kind = 'erase_biometrics' then
    delete from private.biometric_template_versions where employee_id = v_r.employee_id;
    update public.biometric_enrollments set status = 'revoked', revoked_at = now(), revoked_reason = 'solicitud de borrado ' || p_id
     where employee_id = v_r.employee_id and status = 'active';
    update public.biometric_consents set withdrawn_at = coalesce(withdrawn_at, now()) where employee_id = v_r.employee_id;
    update public.retention_requests set status = 'executed', executed_at = now() where id = p_id;
  end if;
end $$;

-- Permisos de ejecución
revoke all on all functions in schema private from public;
revoke execute on all functions in schema public from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.issue_device_activation_code(uuid, int), public.set_device_status(uuid, public.device_status, text),
      public.transfer_employee(uuid, uuid, text, timestamptz, timestamptz, text), public.revoke_assignment(uuid, text),
      public.set_employee_status(uuid, public.employee_status, text),
      public.correct_attendance(text, uuid, text, uuid, public.attendance_event_type, timestamptz, uuid, uuid),
      public.resolve_incident(uuid, public.incident_status, text), public.grant_role(uuid, public.role_code, uuid, uuid, uuid),
      public.revoke_role(uuid), public.decide_retention_request(uuid, boolean, text) to authenticated';
    execute 'grant execute on function private.admin_session_ok(), private.is_superadmin(), private.has_org_perm(text, uuid),
      private.has_store_perm(text, uuid), private.store_ids_with(text), private.is_org_member(uuid), private.can_see_employee(text, uuid),
      private.actor() to authenticated';
    execute 'grant select on public.attendance_events_effective to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema private to service_role';
    execute 'grant all on all tables in schema private to service_role';
    execute 'grant execute on all functions in schema private to service_role';
  end if;
end $$;
