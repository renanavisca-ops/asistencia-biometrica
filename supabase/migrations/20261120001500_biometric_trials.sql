-- =====================================================================================
-- Fase 4 — Validación biométrica con personas y teléfonos reales.
-- El teléfono, en «modo validación», ejecuta la MISMA cadena de captura que la marcación (calidad, prueba de vida,
-- embedding, 1:N) pero NO registra asistencia: guarda cada intento con su condición (persona enrolada, desconocida,
-- foto impresa, foto en pantalla, vídeo…), puntuaciones, tiempos, memoria y batería. Sin imágenes ni plantillas.
-- El panel calcula FAR/FRR/APCER/BPCER con el tamaño de muestra (docs/RESULTADOS_PRUEBAS_BIOMETRICAS.md).
-- =====================================================================================
create table if not exists public.biometric_trials (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  device_id uuid not null references public.devices(id),
  store_id uuid references public.stores(id),
  session_id uuid not null,
  captured_at timestamptz not null,
  received_at timestamptz not null default now(),
  condition text not null check (condition in ('genuine', 'impostor', 'attack_print', 'attack_screen', 'attack_video', 'attack_other', 'benchmark')),
  expected_employee_id uuid,
  lighting text check (lighting in ('normal', 'low', 'backlight', 'outdoor')),
  accessories text,
  challenge_mode text check (challenge_mode in ('none', 'blink', 'random')),
  outcome text not null,
  outcome_reason text,
  identified_employee_id uuid,
  top1_employee_id uuid,
  top1_score real,
  top2_score real,
  passive_score real,
  continuity real,
  challenge_kind text,
  challenge_passed boolean,
  match_threshold real,
  match_margin real,
  pad_threshold real,
  total_ms int,
  timings jsonb not null default '{}',
  device_info jsonb not null default '{}',
  gallery_size int,
  recognition_model text,
  pad_model text,
  app_version text,
  notes text,
  foreign key (expected_employee_id, organization_id) references public.employees(id, organization_id),
  foreign key (identified_employee_id, organization_id) references public.employees(id, organization_id),
  foreign key (top1_employee_id, organization_id) references public.employees(id, organization_id)
);
create index if not exists biometric_trials_org on public.biometric_trials (organization_id, captured_at desc);
alter table public.biometric_trials enable row level security;
create policy biometric_trials_select on public.biometric_trials for select to authenticated
  using (private.has_org_perm('audit.read', organization_id));

-- Ingesta desde el teléfono (autenticado por device-api con su firma). Idempotente por id; valida que los empleados
-- referidos sean de la organización del teléfono (si no, se descarta la referencia, no el intento).
create or replace function private.ingest_biometric_trials(p_device uuid, p_trials jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare d public.devices%rowtype; t jsonb; n int := 0; k int;
  v_exp uuid; v_idf uuid; v_top uuid;
begin
  select * into d from public.devices where id = p_device and status = 'active';
  if not found then raise exception 'device_not_active'; end if;
  if jsonb_typeof(p_trials) <> 'array' or jsonb_array_length(p_trials) > 200 then raise exception 'invalid_trials'; end if;
  for t in select value from jsonb_array_elements(p_trials) loop
    if (t ->> 'condition') not in ('genuine', 'impostor', 'attack_print', 'attack_screen', 'attack_video', 'attack_other', 'benchmark') then continue; end if;
    select e.id into v_exp from public.employees e where e.id = nullif(t ->> 'expectedEmployeeId', '')::uuid and e.organization_id = d.organization_id;
    select e.id into v_idf from public.employees e where e.id = nullif(t ->> 'identifiedEmployeeId', '')::uuid and e.organization_id = d.organization_id;
    select e.id into v_top from public.employees e where e.id = nullif(t -> 'metrics' ->> 'top1EmployeeId', '')::uuid and e.organization_id = d.organization_id;
    insert into public.biometric_trials (id, organization_id, device_id, store_id, session_id, captured_at, condition, expected_employee_id, lighting,
      accessories, challenge_mode, outcome, outcome_reason, identified_employee_id, top1_employee_id, top1_score, top2_score, passive_score, continuity,
      challenge_kind, challenge_passed, match_threshold, match_margin, pad_threshold, total_ms, timings, device_info, gallery_size,
      recognition_model, pad_model, app_version, notes)
    values ((t ->> 'id')::uuid, d.organization_id, d.id, d.store_id, (t ->> 'sessionId')::uuid, (t ->> 'capturedAt')::timestamptz, t ->> 'condition', v_exp,
      nullif(t ->> 'lighting', ''), left(nullif(t ->> 'accessories', ''), 80), nullif(t ->> 'challengeMode', ''), left(t ->> 'outcome', 40),
      left(nullif(t ->> 'outcomeReason', ''), 80), v_idf, v_top,
      (t -> 'metrics' ->> 'top1Score')::real, (t -> 'metrics' ->> 'top2Score')::real, (t -> 'metrics' ->> 'passiveScore')::real,
      (t -> 'metrics' ->> 'continuity')::real, left(t -> 'metrics' ->> 'challengeKind', 20), (t -> 'metrics' ->> 'challengePassed')::boolean,
      (t -> 'thresholds' ->> 'match')::real, (t -> 'thresholds' ->> 'margin')::real, (t -> 'thresholds' ->> 'pad')::real,
      round((t -> 'metrics' ->> 'totalMs')::numeric)::int,
      coalesce((t -> 'metrics') - 'top1EmployeeId', '{}'::jsonb) || coalesce(jsonb_build_object('benchmark', t -> 'benchmark'), '{}'::jsonb),
      coalesce(t -> 'device', '{}'::jsonb), (t -> 'metrics' ->> 'gallerySize')::int,
      left(t ->> 'recognitionModel', 60), left(t ->> 'padModel', 80), left(t ->> 'appVersion', 40), left(nullif(t ->> 'notes', ''), 300))
    on conflict (id) do nothing;
    get diagnostics k = row_count; n := n + k;
  end loop;
  return n;
end $$;

-- Borrado definitivo de la organización: también sus intentos de validación.
create or replace function private.purge_org_extra(p_org uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.enqueue_org_files(p_org);
  delete from public.admin_permission_grants where organization_id = p_org;
  delete from public.alert_notifications where organization_id = p_org;
  delete from public.biometric_trials where organization_id = p_org;
end $$;

revoke all on function private.ingest_biometric_trials(uuid, jsonb) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant select on public.biometric_trials to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.biometric_trials to service_role';
    execute 'grant execute on function private.ingest_biometric_trials(uuid, jsonb) to service_role';
  end if;
end $$;
notify pgrst, 'reload schema';
