-- Etapa 6: salida elegida en pantalla (almuerzo/pausa o fin de turno) y género para el saludo.
-- El tipo de salida viaja FIRMADO dentro de decision_flags del evento ('out_break' / 'out_end'), sin cambiar el protocolo.

-- 1. Género (opcional) solo para el saludo «Bienvenido/Bienvenida». Sin dato → saludo neutro.
alter table public.employees add column if not exists gender text check (gender in ('F', 'M'));
comment on column public.employees.gender is 'Opcional, solo para el saludo en el teléfono (F/M). Sin dato: saludo neutro.';

-- 2. Tipo de salida en la proyección de sesiones (se rellena al reconstruir, desde el evento de salida firmado).
alter table public.attendance_sessions add column if not exists out_kind text check (out_kind in ('break', 'end'));
create or replace function private.session_out_kind() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.out_event_id is not null then
    select case when 'out_break' = any(decision_flags) then 'break' when 'out_end' = any(decision_flags) then 'end' end
      into new.out_kind from public.attendance_events where id = new.out_event_id;
  end if;
  return new;
end $$;
drop trigger if exists attendance_sessions_out_kind on public.attendance_sessions;
create trigger attendance_sessions_out_kind before insert or update of out_event_id on public.attendance_sessions
  for each row execute function private.session_out_kind();
update public.attendance_sessions s set out_kind = case when 'out_break' = any(e.decision_flags) then 'break'
  when 'out_end' = any(e.decision_flags) then 'end' end
  from public.attendance_events e where e.id = s.out_event_id;

-- 3. Roster: género y tipo de la última salida (para «Bienvenido de nuevo» si la salida a almuerzo fue en otro teléfono).
drop function if exists private.device_roster(uuid, int);
create function private.device_roster(p_device_id uuid, p_lease_hours int)
returns table (employee_id uuid, display_name text, gender text, lease_expires_at timestamptz,
               last_event_id uuid, last_event_type public.attendance_event_type, last_event_at timestamptz, last_event_flags text[])
language sql stable security definer set search_path = '' as $$
  select e.id, e.first_name || ' ' || left(e.last_name, 1) || '.', e.gender,
         least(now() + make_interval(hours => p_lease_hours), min(a.valid_to)),
         le.id, le.event_type, le.occurred_at, le.decision_flags
  from public.devices d
  join public.employee_store_assignments a on a.store_id = d.store_id and a.revoked_at is null
       and a.valid_from <= now() and (a.valid_to is null or a.valid_to > now())
  join public.employees e on e.id = a.employee_id and e.status = 'active'
  join public.biometric_enrollments be on be.employee_id = e.id and be.status = 'active'
  join public.biometric_consents c on c.id = be.consent_id and c.withdrawn_at is null
  left join lateral (select x.id, x.event_type, x.occurred_at, ev.decision_flags from public.attendance_events_effective x
                     join public.attendance_events ev on ev.id = x.id
                     where x.employee_id = e.id order by x.occurred_at desc, x.id desc limit 1) le on true
  where d.id = p_device_id and d.status = 'active'
  group by e.id, e.first_name, e.last_name, e.gender, le.id, le.event_type, le.occurred_at, le.decision_flags;
$$;
revoke all on function private.device_roster(uuid, int) from public;

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
    'device', jsonb_build_object('status', v_dev.status, 'storeId', v_store.id, 'storeName', v_store.name, 'timezone', v_store.timezone));
end $$;
revoke all on function private.device_pull(uuid, uuid[]) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function private.device_roster(uuid, int), private.device_pull(uuid, uuid[]) to service_role';
  end if;
end $$;
notify pgrst, 'reload schema';
