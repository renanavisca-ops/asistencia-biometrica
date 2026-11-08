-- Corrección: los eventos con firma inválida se registraban en sync_acknowledgements pero no se devolvían en
-- la respuesta del primer envío (sí en los reintentos). Detectado por supabase/functions/device-api/handler_test.ts.
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
    v_acks := v_acks || jsonb_build_object('eventId', v_inv, 'result', 'rejected', 'reason', 'signature_invalid');
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
