-- Datos de la prueba de navegador del panel (solo en Postgres local). Contraseña de todos: ver gateway.mjs.
\set ON_ERROR_STOP on
insert into auth.users (id, email, email_confirmed_at) values
  ('e2e00000-0000-4000-8000-0000000000a1', 'owner@e2e.test', now()),   -- propietario: superadmin + admin de su empresa
  ('e2e00000-0000-4000-8000-0000000000a2', 'admin@e2e.test', now()),   -- administrador central de Cliente Uno
  ('e2e00000-0000-4000-8000-0000000000a3', 'sup@e2e.test', now()),     -- supervisora de la tienda T1 de Cliente Uno
  ('e2e00000-0000-4000-8000-0000000000a4', 'aud@e2e.test', now());     -- auditor de Cliente Uno
insert into public.admins (user_id, display_name, email) values
  ('e2e00000-0000-4000-8000-0000000000a1', 'Dueño Plataforma', 'owner@e2e.test'), ('e2e00000-0000-4000-8000-0000000000a2', 'Admin Cliente', 'admin@e2e.test'),
  ('e2e00000-0000-4000-8000-0000000000a3', 'Supervisora T1', 'sup@e2e.test'), ('e2e00000-0000-4000-8000-0000000000a4', 'Auditor Cliente', 'aud@e2e.test');
insert into public.organizations (id, name, created_via, unlimited) values
  ('e2e10000-0000-4000-8000-000000000001', 'Mi Empresa', 'owner', true),
  ('e2e10000-0000-4000-8000-000000000002', 'Cliente Uno', 'app_signup', false);
insert into public.regions (id, organization_id, country_code, name, timezone) values
  ('e2e20000-0000-4000-8000-000000000001', 'e2e10000-0000-4000-8000-000000000001', 'GT', 'Guatemala', 'America/Guatemala'),
  ('e2e20000-0000-4000-8000-000000000002', 'e2e10000-0000-4000-8000-000000000002', 'GT', 'Guatemala', 'America/Guatemala');
insert into public.stores (id, organization_id, region_id, code, name, timezone) values
  ('e2e30000-0000-4000-8000-000000000001', 'e2e10000-0000-4000-8000-000000000001', 'e2e20000-0000-4000-8000-000000000001', 'ME1', 'Matriz Mi Empresa', 'America/Guatemala'),
  ('e2e30000-0000-4000-8000-000000000002', 'e2e10000-0000-4000-8000-000000000002', 'e2e20000-0000-4000-8000-000000000002', 'T1', 'Tienda Centro', 'America/Guatemala'),
  ('e2e30000-0000-4000-8000-000000000003', 'e2e10000-0000-4000-8000-000000000002', 'e2e20000-0000-4000-8000-000000000002', 'T2', 'Tienda Norte', 'America/Guatemala');
insert into public.admin_role_grants (user_id, role, organization_id, store_id) values
  ('e2e00000-0000-4000-8000-0000000000a1', 'superadmin', null, null),
  ('e2e00000-0000-4000-8000-0000000000a1', 'central_admin', 'e2e10000-0000-4000-8000-000000000001', null),
  ('e2e00000-0000-4000-8000-0000000000a2', 'central_admin', 'e2e10000-0000-4000-8000-000000000002', null),
  ('e2e00000-0000-4000-8000-0000000000a3', 'supervisor', 'e2e10000-0000-4000-8000-000000000002', 'e2e30000-0000-4000-8000-000000000002'),
  ('e2e00000-0000-4000-8000-0000000000a4', 'auditor', 'e2e10000-0000-4000-8000-000000000002', null);
insert into public.employees (id, organization_id, employee_code, first_name, last_name, hired_on) values
  ('e2e40000-0000-4000-8000-000000000001', 'e2e10000-0000-4000-8000-000000000002', 'C001', 'Ana', 'Tardía', '2026-09-01'),
  ('e2e40000-0000-4000-8000-000000000002', 'e2e10000-0000-4000-8000-000000000002', 'C002', 'Bruno', 'Salida', '2026-09-01'),
  ('e2e40000-0000-4000-8000-000000000003', 'e2e10000-0000-4000-8000-000000000002', 'C003', 'Carla', 'Norte', '2026-09-01'),
  ('e2e40000-0000-4000-8000-000000000004', 'e2e10000-0000-4000-8000-000000000002', 'C004', 'Diego', 'Centro', '2026-09-01'),
  ('e2e40000-0000-4000-8000-000000000009', 'e2e10000-0000-4000-8000-000000000001', 'M001', 'Mario', 'Propio', '2026-09-01');
insert into public.employee_store_assignments (organization_id, employee_id, store_id, valid_from) values
  ('e2e10000-0000-4000-8000-000000000002', 'e2e40000-0000-4000-8000-000000000001', 'e2e30000-0000-4000-8000-000000000002', '2026-09-01T00:00:00Z'),
  ('e2e10000-0000-4000-8000-000000000002', 'e2e40000-0000-4000-8000-000000000002', 'e2e30000-0000-4000-8000-000000000002', '2026-09-01T00:00:00Z'),
  ('e2e10000-0000-4000-8000-000000000002', 'e2e40000-0000-4000-8000-000000000003', 'e2e30000-0000-4000-8000-000000000003', '2026-09-01T00:00:00Z'),
  ('e2e10000-0000-4000-8000-000000000002', 'e2e40000-0000-4000-8000-000000000004', 'e2e30000-0000-4000-8000-000000000002', '2026-09-01T00:00:00Z'),
  ('e2e10000-0000-4000-8000-000000000001', 'e2e40000-0000-4000-8000-000000000009', 'e2e30000-0000-4000-8000-000000000001', '2026-09-01T00:00:00Z');
insert into public.devices (id, organization_id, store_id, label, status, activated_at) values
  ('e2e50000-0000-4000-8000-000000000001', 'e2e10000-0000-4000-8000-000000000002', 'e2e30000-0000-4000-8000-000000000002', 'Tel T1', 'active', '2026-09-01');

-- Marcaciones de octubre (Guatemala UTC-6): Ana llega 08:20, 08:15 y 08:30 → 3 tardanzas con horario 08:00 (+5).
set role service_role;
select private.ingest_device_events('e2e50000-0000-4000-8000-000000000001', 'e2e60000-0000-4000-8000-000000000001', (
  select jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'storeId', 'e2e30000-0000-4000-8000-000000000002', 'employeeId', 'e2e40000-0000-4000-8000-000000000001',
    'eventType', t, 'deviceSeq', s, 'occurredAt', at, 'tzOffsetMin', -360, 'monotonicMs', s, 'bootId', 'e2e', 'clockFlags', '[]'::jsonb, 'decisionFlags',
    case when t = 'OUT' then '["out_end"]'::jsonb else '[]'::jsonb end, 'capturedOffline', false, 'policyVersion', 1, 'appVersion', 'e2e', 'signature', 'sig'))
  from (values (1, 'IN', '2026-10-05T14:20:00Z'), (2, 'OUT', '2026-10-05T23:00:00Z'), (3, 'IN', '2026-10-06T14:15:00Z'), (4, 'OUT', '2026-10-06T23:00:00Z'),
               (5, 'IN', '2026-10-07T14:30:00Z'), (6, 'OUT', '2026-10-07T23:00:00Z')) v(s, t, at))) is not null;
reset role;

-- Como administrador de Cliente Uno: horario de T1 (5 al 9 de octubre), recálculo y baja de Bruno con motivo.
begin;
select set_config('request.jwt.claims', '{"sub":"e2e00000-0000-4000-8000-0000000000a2","aal":"aal2","role":"authenticated"}', true);
set local role authenticated;
insert into public.work_schedules (id, organization_id, name, tolerance_minutes) values ('e2e70000-0000-4000-8000-000000000001', 'e2e10000-0000-4000-8000-000000000002', 'Mañana T1', 5);
insert into public.work_schedule_days (organization_id, schedule_id, weekday, start_time, end_time)
  select 'e2e10000-0000-4000-8000-000000000002', 'e2e70000-0000-4000-8000-000000000001', d, '08:00', '17:00' from generate_series(1, 7) d;
insert into public.schedule_assignments (organization_id, schedule_id, store_id, valid_from, valid_to)
  values ('e2e10000-0000-4000-8000-000000000002', 'e2e70000-0000-4000-8000-000000000001', 'e2e30000-0000-4000-8000-000000000002', '2026-10-05', '2026-10-07');
select public.recompute_tardiness('e2e10000-0000-4000-8000-000000000002', '2026-10-01');
select public.terminate_employee('e2e40000-0000-4000-8000-000000000002', 'dismissal', current_date, 'Faltante de mercadería comprobado en inventario',
  'Se entregó carta', 'Confidencial', null);
commit;

-- Intentos del modo validación biométrica (como los enviaría el teléfono T1).
set role service_role;
select private.ingest_biometric_trials('e2e50000-0000-4000-8000-000000000001', jsonb_build_array(
  jsonb_build_object('id', gen_random_uuid(), 'sessionId', 'e2e80000-0000-4000-8000-000000000001', 'capturedAt', now(), 'condition', 'genuine',
    'expectedEmployeeId', 'e2e40000-0000-4000-8000-000000000001', 'identifiedEmployeeId', 'e2e40000-0000-4000-8000-000000000001', 'outcome', 'identified',
    'challengeMode', 'blink', 'lighting', 'normal', 'metrics', jsonb_build_object('totalMs', 2300, 'top1EmployeeId', 'e2e40000-0000-4000-8000-000000000001',
    'top1Score', 0.71, 'top2Score', 0.18, 'passiveScore', 0.95, 'detectMs', 95, 'embedMs', 60, 'padMs', 45), 'device', jsonb_build_object('memoryMb', 180, 'battery', 0.9)),
  jsonb_build_object('id', gen_random_uuid(), 'sessionId', 'e2e80000-0000-4000-8000-000000000001', 'capturedAt', now(), 'condition', 'genuine',
    'expectedEmployeeId', 'e2e40000-0000-4000-8000-000000000001', 'identifiedEmployeeId', 'e2e40000-0000-4000-8000-000000000001', 'outcome', 'identified',
    'challengeMode', 'blink', 'lighting', 'low', 'metrics', jsonb_build_object('totalMs', 2900, 'top1EmployeeId', 'e2e40000-0000-4000-8000-000000000001',
    'top1Score', 0.58, 'top2Score', 0.21, 'passiveScore', 0.88), 'device', jsonb_build_object('memoryMb', 190, 'battery', 0.88)),
  jsonb_build_object('id', gen_random_uuid(), 'sessionId', 'e2e80000-0000-4000-8000-000000000001', 'capturedAt', now(), 'condition', 'genuine',
    'expectedEmployeeId', 'e2e40000-0000-4000-8000-000000000001', 'outcome', 'liveness_failed', 'outcomeReason', 'passive', 'challengeMode', 'blink',
    'lighting', 'backlight', 'metrics', jsonb_build_object('totalMs', 3100, 'passiveScore', 0.62)),
  jsonb_build_object('id', gen_random_uuid(), 'sessionId', 'e2e80000-0000-4000-8000-000000000001', 'capturedAt', now(), 'condition', 'impostor',
    'outcome', 'not_recognized', 'challengeMode', 'blink', 'lighting', 'normal', 'metrics', jsonb_build_object('totalMs', 2500,
    'top1EmployeeId', 'e2e40000-0000-4000-8000-000000000004', 'top1Score', 0.22, 'top2Score', 0.1, 'passiveScore', 0.93)),
  jsonb_build_object('id', gen_random_uuid(), 'sessionId', 'e2e80000-0000-4000-8000-000000000001', 'capturedAt', now(), 'condition', 'attack_print',
    'outcome', 'liveness_failed', 'outcomeReason', 'challenge_timeout', 'challengeMode', 'blink', 'lighting', 'normal', 'metrics', jsonb_build_object('passiveScore', 0.41)),
  jsonb_build_object('id', gen_random_uuid(), 'sessionId', 'e2e80000-0000-4000-8000-000000000001', 'capturedAt', now(), 'condition', 'benchmark',
    'outcome', 'benchmark', 'metrics', jsonb_build_object('templatesPerEmployee', 3), 'benchmark', jsonb_build_object('msByGallerySize', jsonb_build_object('n100', 0.4, 'n1000', 3.9)))
)) = 6;
reset role;
