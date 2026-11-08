-- =====================================================================================
-- Asistencia biométrica multitienda — esquema base
-- Multi-organización / multi-país. Toda tabla de negocio lleva organization_id y claves
-- foráneas compuestas (id, organization_id) para impedir referencias entre organizaciones.
-- =====================================================================================

create extension if not exists pgcrypto with schema extensions;

-- Esquema privado: no expuesto por la API (PostgREST). Plantillas biométricas, nonces y helpers.
create schema if not exists private;
revoke all on schema private from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on schema private from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on schema private from authenticated'; end if;
end $$;

-- ---------- Tipos ----------
create type public.employee_status as enum ('active', 'suspended', 'terminated');
create type public.device_status   as enum ('pending', 'active', 'blocked', 'retired');
create type public.attendance_event_type as enum ('IN', 'OUT');
create type public.event_status    as enum ('accepted', 'needs_review', 'rejected');
create type public.event_source    as enum ('biometric', 'supervised_exception', 'admin_correction');
create type public.role_code       as enum ('superadmin', 'central_admin', 'supervisor', 'auditor');
create type public.incident_status as enum ('open', 'resolved', 'dismissed');
create type public.incident_kind   as enum (
  'missing_out', 'orphan_out', 'duplicate', 'offline_conflict', 'recognition_failed', 'clock_anomaly',
  'long_open_session', 'unassigned_store', 'inactive_employee', 'signature_invalid', 'sequence_gap',
  'sequence_conflict', 'cross_store_session', 'device_offline'
);

-- ---------- Organización y territorio ----------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 200),
  created_at timestamptz not null default now()
);

create table public.regions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  country_code char(2) not null check (country_code ~ '^[A-Z]{2}$'),
  name text not null,
  timezone text not null, -- IANA, p. ej. America/Guatemala
  created_at timestamptz not null default now(),
  unique (organization_id, country_code, name),
  unique (id, organization_id)
);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  region_id uuid not null,
  code text not null check (code ~ '^[A-Za-z0-9_-]{1,40}$'),
  name text not null,
  timezone text not null,
  address text,
  is_central boolean not null default false, -- sede central de enrolamiento
  status text not null default 'active' check (status in ('active', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  unique (id, organization_id),
  foreign key (region_id, organization_id) references public.regions(id, organization_id)
);
create index on public.stores (region_id);

-- ---------- Empleados ----------
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  employee_code text not null,
  first_name text not null,
  last_name text not null,
  document_last4 text check (document_last4 ~ '^[A-Za-z0-9]{1,4}$'), -- minimización: no se guarda el documento completo
  status public.employee_status not null default 'active',
  hired_on date,
  terminated_on date,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  unique (organization_id, employee_code),
  unique (id, organization_id)
);
create index on public.employees (organization_id, status);
create index on public.employees (organization_id, lower(last_name), lower(first_name));

create table public.employee_status_history (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  employee_id uuid not null,
  from_status public.employee_status,
  to_status public.employee_status not null,
  reason text,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  foreign key (employee_id, organization_id) references public.employees(id, organization_id)
);

create table public.employee_store_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null,
  store_id uuid not null,
  kind text not null default 'permanent' check (kind in ('permanent', 'temporary')),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  revoked_at timestamptz,
  revoked_by uuid,
  reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to > valid_from),
  check (kind = 'permanent' or valid_to is not null), -- las temporales deben tener fin
  foreign key (employee_id, organization_id) references public.employees(id, organization_id),
  foreign key (store_id, organization_id) references public.stores(id, organization_id)
);
create index on public.employee_store_assignments (store_id) where revoked_at is null;
create index on public.employee_store_assignments (employee_id) where revoked_at is null;

-- ---------- Administradores y RBAC ----------
create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  email text not null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  mfa_required boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.roles (
  code public.role_code primary key,
  description text not null
);

create table public.role_permissions (
  role public.role_code not null references public.roles(code),
  permission text not null,
  primary key (role, permission)
);

create table public.admin_role_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.admins(user_id) on delete cascade,
  role public.role_code not null references public.roles(code),
  organization_id uuid references public.organizations(id),
  region_id uuid references public.regions(id),
  store_id uuid references public.stores(id),
  granted_by uuid,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  check ((role = 'superadmin') = (organization_id is null)),
  check (role <> 'supervisor' or store_id is not null or region_id is not null),
  check (role in ('supervisor', 'auditor') or (store_id is null and region_id is null))
);
create index on public.admin_role_grants (user_id) where revoked_at is null;

-- ---------- Dispositivos ----------
create table public.device_policy_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  version int not null check (version > 0),
  policy jsonb not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (organization_id, version)
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null,
  label text not null,
  platform text check (platform in ('android', 'ios')),
  status public.device_status not null default 'pending',
  activated_at timestamptz,
  last_seen_at timestamptz,
  last_sync_at timestamptz,
  last_device_seq bigint not null default 0,
  app_version text,
  os_version text,
  hardware_model text,
  blocked_reason text,
  replaced_device_id uuid references public.devices(id),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (store_id, organization_id) references public.stores(id, organization_id)
);
create index on public.devices (store_id);

-- Códigos de activación de un solo uso (se guarda solo el hash).
create table public.device_enrollments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  device_id uuid not null,
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  attempts int not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key (device_id, organization_id) references public.devices(id, organization_id)
);
create index on public.device_enrollments (device_id);

-- Claves públicas del dispositivo; la privada nunca sale del teléfono.
create table public.device_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  device_id uuid not null,
  alg text not null default 'ed25519' check (alg = 'ed25519'),
  public_key text not null,
  key_storage text, -- 'android_keystore' | 'ios_keychain' | 'software' (declarado por la app)
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text,
  foreign key (device_id, organization_id) references public.devices(id, organization_id)
);
create unique index device_credentials_one_active on public.device_credentials (device_id) where revoked_at is null;
create unique index device_credentials_pubkey on public.device_credentials (public_key);

create table public.device_health (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  device_id uuid not null,
  reported_at timestamptz not null default now(),
  pending_events int,
  battery_pct int,
  free_storage_mb int,
  app_version text,
  os_version text,
  recognition_model text,
  pad_model text,
  clock_offset_ms bigint,
  flags text[] not null default '{}',
  foreign key (device_id, organization_id) references public.devices(id, organization_id)
);
create index on public.device_health (device_id, reported_at desc);

-- ---------- Modelos y biometría ----------
create table public.model_versions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('detection', 'recognition', 'pad')),
  name text not null,
  version text not null,
  vendor text,
  license text not null,
  embedding_dim int,
  status text not null default 'evaluation' check (status in ('evaluation', 'approved', 'retired')),
  notes text,
  created_at timestamptz not null default now(),
  unique (kind, name, version)
);

create table public.liveness_policy_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  version int not null,
  pad_model_id uuid not null references public.model_versions(id),
  min_score numeric not null,
  config jsonb not null default '{}',
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (organization_id, version)
);

create table public.biometric_consents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null,
  legal_basis text not null, -- p. ej. 'consentimiento_expreso'; validar por país
  notice_version text not null,
  accepted_at timestamptz not null,
  evidence_ref text, -- referencia al documento firmado (custodia fuera del sistema o bucket privado)
  recorded_by uuid not null,
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (employee_id, organization_id) references public.employees(id, organization_id)
);

create table public.biometric_enrollments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null,
  consent_id uuid not null references public.biometric_consents(id),
  status text not null default 'active' check (status in ('active', 'superseded', 'revoked')),
  enrolled_at timestamptz not null default now(),
  enrolled_by uuid not null,
  enrolled_at_store_id uuid not null references public.stores(id),
  identity_verification_method text not null,
  sample_count int not null check (sample_count >= 1),
  quality jsonb not null default '{}',
  pad_passed boolean not null,
  pad_score real,
  recognition_model_id uuid not null references public.model_versions(id),
  pad_model_id uuid references public.model_versions(id),
  revoked_at timestamptz,
  revoked_reason text,
  foreign key (employee_id, organization_id) references public.employees(id, organization_id)
);
create unique index biometric_enrollments_one_active on public.biometric_enrollments (employee_id) where status = 'active';

-- Plantillas (embeddings) cifradas a nivel de aplicación (AES-256-GCM, clave en secretos de Edge Functions).
-- Esquema privado: sin acceso desde la API ni desde el panel.
create table private.biometric_template_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  enrollment_id uuid not null references public.biometric_enrollments(id) on delete cascade,
  employee_id uuid not null,
  model_version_id uuid not null references public.model_versions(id),
  dims int not null,
  key_id text not null,
  ciphertext bytea not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index on private.biometric_template_versions (employee_id) where revoked_at is null;

-- ---------- Sincronización ----------
create table public.sync_batches (
  id uuid primary key, -- generado por el dispositivo; un reintento reutiliza el mismo id
  organization_id uuid not null,
  device_id uuid not null,
  received_at timestamptz not null default now(),
  event_count int not null,
  accepted_count int not null default 0,
  duplicate_count int not null default 0,
  review_count int not null default 0,
  rejected_count int not null default 0,
  foreign key (device_id, organization_id) references public.devices(id, organization_id)
);
create index on public.sync_batches (device_id, received_at desc);

create table public.sync_acknowledgements (
  batch_id uuid not null references public.sync_batches(id),
  event_id uuid not null,
  result text not null check (result in ('accepted', 'duplicate', 'needs_review', 'rejected')),
  reason text,
  primary key (batch_id, event_id)
);

create table private.device_challenges (
  challenge text primary key,
  device_id uuid not null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);

-- ---------- Asistencia (append-only) ----------
create table public.attendance_events (
  id uuid primary key, -- generado en el dispositivo (idempotencia)
  organization_id uuid not null,
  store_id uuid not null,
  device_id uuid,
  employee_id uuid not null,
  event_type public.attendance_event_type not null,
  source public.event_source not null,
  status public.event_status not null,
  review_reasons text[] not null default '{}',
  device_seq bigint,
  occurred_at timestamptz not null,
  tz_offset_min int,
  device_monotonic_ms bigint,
  device_boot_id text,
  last_server_time timestamptz,
  est_clock_offset_ms bigint,
  clock_flags text[] not null default '{}',
  decision_flags text[] not null default '{}',
  captured_offline boolean not null default false,
  match_score real,
  match_margin real,
  pad_score real,
  recognition_model text,
  pad_model text,
  policy_version int,
  app_version text,
  signature text,
  payload_hash text,
  sync_batch_id uuid references public.sync_batches(id),
  correction_id uuid,
  supervised_by uuid,
  received_at timestamptz not null default now(),
  check (source <> 'biometric' or (device_id is not null and device_seq is not null and signature is not null)),
  check (source <> 'admin_correction' or correction_id is not null),
  check (source <> 'supervised_exception' or supervised_by is not null),
  foreign key (employee_id, organization_id) references public.employees(id, organization_id),
  foreign key (store_id, organization_id) references public.stores(id, organization_id),
  foreign key (device_id, organization_id) references public.devices(id, organization_id)
);
create unique index attendance_events_device_seq on public.attendance_events (device_id, device_seq) where device_id is not null;
create index on public.attendance_events (employee_id, occurred_at);
create index on public.attendance_events (store_id, occurred_at);
create index on public.attendance_events (organization_id, occurred_at);

create table public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null,
  kind text not null check (kind in ('confirm', 'void', 'add')),
  target_event_id uuid references public.attendance_events(id),
  new_event_id uuid references public.attendance_events(id) deferrable initially deferred,
  previous jsonb,
  new_values jsonb,
  reason text not null check (length(trim(reason)) >= 10),
  incident_id uuid,
  actor uuid not null,
  created_at timestamptz not null default now(),
  check (kind = 'add' or target_event_id is not null),
  foreign key (employee_id, organization_id) references public.employees(id, organization_id)
);
create index on public.attendance_corrections (target_event_id);
alter table public.attendance_events
  add constraint attendance_events_correction_fk foreign key (correction_id) references public.attendance_corrections(id) deferrable initially deferred;

-- Proyección derivada (reconstruible en cualquier momento a partir de eventos + correcciones).
create table public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null,
  store_id uuid not null,
  in_event_id uuid references public.attendance_events(id),
  out_event_id uuid references public.attendance_events(id),
  opened_at timestamptz,
  closed_at timestamptz,
  duration_seconds bigint generated always as (extract(epoch from (closed_at - opened_at))::bigint) stored,
  state text not null check (state in ('open', 'closed', 'missing_out', 'orphan_out')),
  cross_store boolean not null default false,
  needs_review boolean not null default false,
  rebuilt_at timestamptz not null default now()
);
create index on public.attendance_sessions (employee_id, opened_at);
create index on public.attendance_sessions (store_id, opened_at);
create index on public.attendance_sessions (organization_id, coalesce(opened_at, closed_at));

-- ---------- Incidencias, seguridad, auditoría ----------
create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid references public.stores(id),
  employee_id uuid references public.employees(id),
  device_id uuid references public.devices(id),
  kind public.incident_kind not null,
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high')),
  status public.incident_status not null default 'open',
  dedup_key text,
  details jsonb not null default '{}',
  event_ids uuid[] not null default '{}',
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution text
);
create unique index incidents_dedup_open on public.incidents (dedup_key) where status = 'open' and dedup_key is not null;
create index on public.incidents (organization_id, status, opened_at desc);
create index on public.incidents (store_id, status);
alter table public.attendance_corrections
  add constraint attendance_corrections_incident_fk foreign key (incident_id) references public.incidents(id);

create table public.security_events (
  id bigint generated always as identity primary key,
  organization_id uuid,
  device_id uuid,
  actor uuid,
  kind text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on public.security_events (organization_id, created_at desc);

create table public.audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid,
  actor uuid,
  actor_kind text not null check (actor_kind in ('admin', 'device', 'system')),
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);
create index on public.audit_log (organization_id, at desc);
create index on public.audit_log (entity, entity_id);

create table public.retention_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null,
  kind text not null check (kind in ('erase_biometrics', 'export_data', 'erase_personal_data')),
  status text not null default 'requested' check (status in ('requested', 'approved', 'executed', 'rejected')),
  reason text not null,
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  executed_at timestamptz,
  notes text,
  foreign key (employee_id, organization_id) references public.employees(id, organization_id)
);
