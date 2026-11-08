-- Pruebas de aislamiento RLS, ingesta idempotente, incidencias y correcciones auditadas.
\set QUIET on
\pset tuples_only on
\pset format unaligned
create schema test;
create function test.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FALLO: %', msg; end if; raise notice 'ok - %', msg; end $$;
create function test.as_user(uid uuid, aal text default 'aal2') returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', aal, 'role', 'authenticated')::text, false);
      execute 'set role authenticated'; end $$;
create function test.reset() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '', false); end $$;
create function test.raises(sql text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return true; end $$;
create function test.ack(acks jsonb, id text) returns jsonb language sql as $$
  select x from jsonb_array_elements(acks) x where x ->> 'eventId' = id $$;
grant usage on schema test to authenticated, anon, service_role; grant execute on all functions in schema test to authenticated, anon, service_role;

-- ---------- Fixtures ----------
insert into public.organizations (id, name) values
  ('a0000000-0000-4000-8000-000000000000', 'Org A'), ('b0000000-0000-4000-8000-000000000000', 'Org B');
insert into public.regions (id, organization_id, country_code, name, timezone) values
  ('a1000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000000', 'GT', 'Guatemala', 'America/Guatemala'),
  ('b1000000-0000-4000-8000-000000000000', 'b0000000-0000-4000-8000-000000000000', 'CR', 'Costa Rica', 'America/Costa_Rica');
insert into public.stores (id, organization_id, region_id, code, name, timezone, is_central) values
  ('a2000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000000', 'a1000000-0000-4000-8000-000000000000', 'A1', 'Tienda A1', 'America/Guatemala', false),
  ('a2000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000000', 'a1000000-0000-4000-8000-000000000000', 'A2', 'Tienda A2', 'America/Guatemala', false),
  ('a2000000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000000', 'a1000000-0000-4000-8000-000000000000', 'HQ', 'Sede central A', 'America/Guatemala', true),
  ('b2000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000000', 'b1000000-0000-4000-8000-000000000000', 'B1', 'Tienda B1', 'America/Costa_Rica', false);
insert into public.employees (id, organization_id, employee_code, first_name, last_name) values
  ('a3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000000', 'E1', 'Ana', 'Pérez'),
  ('a3000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000000', 'E2', 'Luis', 'Gómez'),
  ('b3000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000000', 'E1', 'Rosa', 'Mora');
insert into public.employee_store_assignments (organization_id, employee_id, store_id, valid_from) values
  ('a0000000-0000-4000-8000-000000000000', 'a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', now() - interval '30 days'),
  ('a0000000-0000-4000-8000-000000000000', 'a3000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000002', now() - interval '30 days'),
  ('b0000000-0000-4000-8000-000000000000', 'b3000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', now() - interval '30 days');

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'super@x'), ('00000000-0000-4000-8000-00000000000b', 'ca@x'),
  ('00000000-0000-4000-8000-00000000000c', 'sv@x'), ('00000000-0000-4000-8000-00000000000d', 'cb@x'),
  ('00000000-0000-4000-8000-00000000000e', 'au@x');
insert into public.admins (user_id, display_name, email) select id, email, email from auth.users;
insert into public.admin_role_grants (user_id, role, organization_id, store_id) values
  ('00000000-0000-4000-8000-00000000000a', 'superadmin', null, null),
  ('00000000-0000-4000-8000-00000000000b', 'central_admin', 'a0000000-0000-4000-8000-000000000000', null),
  ('00000000-0000-4000-8000-00000000000c', 'supervisor', 'a0000000-0000-4000-8000-000000000000', 'a2000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-00000000000d', 'central_admin', 'b0000000-0000-4000-8000-000000000000', null),
  ('00000000-0000-4000-8000-00000000000e', 'auditor', 'a0000000-0000-4000-8000-000000000000', null);

insert into public.model_versions (id, kind, name, version, license, embedding_dim) values
  ('c0000000-0000-4000-8000-000000000001', 'recognition', 'test-model', '0', 'TEST ONLY', 3);
insert into public.biometric_consents (id, organization_id, employee_id, legal_basis, notice_version, accepted_at, recorded_by) values
  ('c1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000000', 'a3000000-0000-4000-8000-000000000001', 'consentimiento_expreso', 'v1', now(), '00000000-0000-4000-8000-00000000000b');
insert into public.biometric_enrollments (organization_id, employee_id, consent_id, enrolled_by, enrolled_at_store_id, identity_verification_method, sample_count, pad_passed, recognition_model_id)
values ('a0000000-0000-4000-8000-000000000000', 'a3000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000b',
        'a2000000-0000-4000-8000-000000000009', 'documento_presencial', 5, true, 'c0000000-0000-4000-8000-000000000001');

insert into public.devices (id, organization_id, store_id, label, status, activated_at) values
  ('d0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000000', 'a2000000-0000-4000-8000-000000000001', 'Teléfono A1', 'active', now() - interval '10 days');

-- ---------- Aislamiento RLS ----------
select test.as_user('00000000-0000-4000-8000-00000000000b');
select test.ok((select count(*) from public.employees) = 2, 'admin central A ve solo los 2 empleados de A');
select test.ok((select count(*) from public.stores) = 3, 'admin central A ve solo tiendas de A');
select test.ok(test.raises($$insert into public.employees (organization_id, employee_code, first_name, last_name) values ('b0000000-0000-4000-8000-000000000000','X','x','x')$$), 'admin A no puede crear empleados en B');
select test.ok(test.raises($$update public.employees set organization_id = 'b0000000-0000-4000-8000-000000000000' where employee_code = 'E1'$$), 'organization_id inmutable / sin cruce');
select test.ok((select count(*) from public.device_enrollments) = 0, 'hashes de activación no visibles');
select test.ok(test.raises($$select * from private.biometric_template_versions$$), 'plantillas biométricas inaccesibles para administradores');
select test.ok(test.raises($$insert into public.attendance_events (id, organization_id, store_id, employee_id, event_type, source, status, occurred_at) values (gen_random_uuid(),'a0000000-0000-4000-8000-000000000000','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','IN','admin_correction','accepted',now())$$), 'nadie inserta asistencia directamente');
select test.reset();

select test.as_user('00000000-0000-4000-8000-00000000000b', 'aal1');
select test.ok((select count(*) from public.employees) = 0, 'sin MFA (aal1) no se ve nada');
select test.reset();

select test.as_user('00000000-0000-4000-8000-00000000000c');
select test.ok((select count(*) from public.employees) = 1, 'supervisor de A1 ve solo empleados asignados a A1');
select test.ok((select count(*) from public.stores) = 1, 'supervisor ve solo su tienda');
select test.ok(test.raises($$insert into public.employees (organization_id, employee_code, first_name, last_name) values ('a0000000-0000-4000-8000-000000000000','X','x','x')$$), 'supervisor no crea empleados');
select test.ok(test.raises($$select public.issue_device_activation_code('d0000000-0000-4000-8000-000000000001')$$), 'supervisor no emite códigos de activación');
select test.reset();

select test.as_user('00000000-0000-4000-8000-00000000000d');
select test.ok((select count(*) from public.employees) = 1 and (select organization_id from public.employees limit 1) = 'b0000000-0000-4000-8000-000000000000', 'admin B ve solo B');
select test.ok((select count(*) from public.devices) = 0, 'admin B no ve dispositivos de A');
select test.reset();

set role anon;
select test.ok(test.raises($$select * from public.employees$$), 'anon sin acceso');
reset role;

-- ---------- Ingesta (como service_role, tras verificación de firma en la Edge Function) ----------
set role service_role;
create temp table acks1 as select private.ingest_device_events('d0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', $$[
  {"id":"e1000000-0000-4000-8000-000000000001","storeId":"a2000000-0000-4000-8000-000000000001","employeeId":"a3000000-0000-4000-8000-000000000001","eventType":"IN","deviceSeq":1,"occurredAt":"2026-11-07T14:00:00Z","tzOffsetMin":-360,"monotonicMs":1000,"bootId":"b1","clockFlags":[],"decisionFlags":[],"capturedOffline":true,"policyVersion":1,"appVersion":"0.1.0","signature":"sig"},
  {"id":"e1000000-0000-4000-8000-000000000002","storeId":"a2000000-0000-4000-8000-000000000001","employeeId":"a3000000-0000-4000-8000-000000000001","eventType":"OUT","deviceSeq":2,"occurredAt":"2026-11-07T22:00:00Z","tzOffsetMin":-360,"monotonicMs":2000,"bootId":"b1","clockFlags":[],"decisionFlags":[],"capturedOffline":true,"policyVersion":1,"appVersion":"0.1.0","signature":"sig"},
  {"id":"e1000000-0000-4000-8000-000000000003","storeId":"a2000000-0000-4000-8000-000000000001","employeeId":"a3000000-0000-4000-8000-000000000002","eventType":"IN","deviceSeq":3,"occurredAt":"2026-11-07T15:00:00Z","tzOffsetMin":-360,"monotonicMs":3000,"bootId":"b1","clockFlags":["reboot_since_server_sync"],"decisionFlags":[],"capturedOffline":true,"policyVersion":1,"appVersion":"0.1.0","signature":"sig"},
  {"id":"e1000000-0000-4000-8000-000000000004","storeId":"a2000000-0000-4000-8000-000000000001","employeeId":"b3000000-0000-4000-8000-000000000001","eventType":"IN","deviceSeq":4,"occurredAt":"2026-11-07T15:00:00Z","tzOffsetMin":-360,"monotonicMs":4000,"bootId":"b1","clockFlags":[],"decisionFlags":[],"capturedOffline":true,"policyVersion":1,"appVersion":"0.1.0","signature":"sig"}
]$$::jsonb, array['e1000000-0000-4000-8000-0000000000ff']::uuid[]) a;
select test.ok((select test.ack(a, 'e1000000-0000-4000-8000-000000000001') ->> 'result' from acks1) = 'accepted', 'ENTRADA válida aceptada');
select test.ok((select test.ack(a, 'e1000000-0000-4000-8000-000000000002') ->> 'result' from acks1) = 'accepted', 'SALIDA válida aceptada');
select test.ok((select test.ack(a, 'e1000000-0000-4000-8000-000000000003') ->> 'result' from acks1) = 'needs_review' and (select test.ack(a, 'e1000000-0000-4000-8000-000000000003') ->> 'reason' from acks1) like '%unassigned_store%' and (select test.ack(a, 'e1000000-0000-4000-8000-000000000003') ->> 'reason' from acks1) like '%clock_anomaly%', 'empleado no asignado y reloj dudoso → revisión, no se pierde');
select test.ok((select test.ack(a, 'e1000000-0000-4000-8000-000000000004') ->> 'reason' from acks1) = 'unknown_employee', 'empleado de otra organización rechazado');
select test.ok((select count(*) from public.sync_acknowledgements where reason = 'signature_invalid') = 1, 'firma inválida registrada como rechazada');

create temp table acks_retry as select private.ingest_device_events('d0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', '[]'::jsonb) a;
select test.ok((select jsonb_array_length(a) from acks_retry) = 5, 'reintento del mismo lote devuelve los mismos acuses');

create temp table acks2 as select private.ingest_device_events('d0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002', $$[
  {"id":"e1000000-0000-4000-8000-000000000001","storeId":"a2000000-0000-4000-8000-000000000001","employeeId":"a3000000-0000-4000-8000-000000000001","eventType":"IN","deviceSeq":1,"occurredAt":"2026-11-07T14:00:00Z","tzOffsetMin":-360,"monotonicMs":1000,"bootId":"b1","clockFlags":[],"decisionFlags":[],"capturedOffline":true,"policyVersion":1,"appVersion":"0.1.0","signature":"sig"},
  {"id":"e1000000-0000-4000-8000-000000000009","storeId":"a2000000-0000-4000-8000-000000000001","employeeId":"a3000000-0000-4000-8000-000000000001","eventType":"IN","deviceSeq":2,"occurredAt":"2026-11-08T14:00:00Z","tzOffsetMin":-360,"monotonicMs":1000,"bootId":"b2","clockFlags":[],"decisionFlags":[],"capturedOffline":true,"policyVersion":1,"appVersion":"0.1.0","signature":"sig"}
]$$::jsonb) a;
select test.ok((select a -> 0 ->> 'result' from acks2) = 'duplicate', 'evento reenviado en otro lote → duplicado, sin doble registro');
select test.ok((select a -> 1 ->> 'reason' from acks2) = 'sequence_conflict', 'secuencia reutilizada con otro id → rechazo (posible clon)');
select test.ok((select count(*) from public.attendance_events) = 3, 'exactamente 3 eventos almacenados');
select test.ok((select count(*) from public.attendance_sessions where employee_id = 'a3000000-0000-4000-8000-000000000001' and state = 'closed' and duration_seconds = 8*3600) = 1, 'sesión cerrada con permanencia de 8 h');
select test.ok((select count(*) from public.incidents where kind = 'sequence_conflict') = 1 and (select count(*) from public.incidents where kind = 'unassigned_store') = 1, 'incidencias generadas');

-- Conflicto offline: otra ENTRADA del mismo empleado desde otro dispositivo en mitad de la sesión.
reset role;
insert into public.devices (id, organization_id, store_id, label, status, activated_at) values
  ('d0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000000', 'a2000000-0000-4000-8000-000000000001', 'Teléfono A1 bis', 'active', now() - interval '10 days');
set role service_role;
create temp table acks3 as select private.ingest_device_events('d0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000003', $$[
  {"id":"e2000000-0000-4000-8000-000000000001","storeId":"a2000000-0000-4000-8000-000000000001","employeeId":"a3000000-0000-4000-8000-000000000001","eventType":"IN","deviceSeq":1,"occurredAt":"2026-11-07T18:00:00Z","tzOffsetMin":-360,"monotonicMs":1,"bootId":"x","clockFlags":[],"decisionFlags":[],"capturedOffline":true,"policyVersion":1,"appVersion":"0.1.0","signature":"sig"}
]$$::jsonb) a;
select test.ok((select a -> 0 ->> 'result' from acks3) = 'needs_review' and exists (select 1 from public.incidents where kind = 'offline_conflict'), 'marcación contradictoria entre dispositivos → revisión + incidencia offline_conflict');
select test.ok(test.raises($$update public.attendance_events set event_type = 'OUT' where id = 'e2000000-0000-4000-8000-000000000001'$$), 'eventos inmutables incluso para service_role');
select test.ok(test.raises($$delete from public.attendance_events$$), 'eventos no se pueden borrar');
reset role;

-- ---------- Visibilidad de asistencia ----------
select test.as_user('00000000-0000-4000-8000-00000000000c');
select test.ok((select count(*) from public.attendance_events) = 4, 'supervisor A1 ve los 4 eventos de su tienda');
select test.ok(test.raises($$select public.correct_attendance('void', 'a3000000-0000-4000-8000-000000000001', 'motivo de prueba largo', 'e2000000-0000-4000-8000-000000000001')$$), 'supervisor no puede corregir asistencia');
select test.reset();
select test.as_user('00000000-0000-4000-8000-00000000000d');
select test.ok((select count(*) from public.attendance_events) = 0 and (select count(*) from public.incidents) = 0, 'admin B no ve asistencia ni incidencias de A');
select test.reset();

-- ---------- Corrección auditada ----------
select test.as_user('00000000-0000-4000-8000-00000000000b');
select test.ok(test.raises($$select public.correct_attendance('void', 'a3000000-0000-4000-8000-000000000001', 'corto', 'e2000000-0000-4000-8000-000000000001')$$), 'corrección exige justificación');
select public.correct_attendance('void', 'a3000000-0000-4000-8000-000000000001', 'Marcación duplicada desde teléfono de respaldo', 'e2000000-0000-4000-8000-000000000001');
select test.ok((select count(*) from public.attendance_events_effective where employee_id = 'a3000000-0000-4000-8000-000000000001') = 2, 'evento anulado deja de ser efectivo');
select test.ok((select count(*) from public.attendance_events where id = 'e2000000-0000-4000-8000-000000000001') = 1, 'el evento original se conserva');
select test.ok((select count(*) from public.attendance_sessions where employee_id = 'a3000000-0000-4000-8000-000000000001') = 1, 'sesiones reconstruidas tras la corrección');
select public.correct_attendance('add', 'a3000000-0000-4000-8000-000000000001', 'Olvidó marcar salida; confirmado por supervisor', null, 'IN', now() - interval '1 hour', 'a2000000-0000-4000-8000-000000000001');
select test.ok((select count(*) from public.attendance_events where source = 'admin_correction' and correction_id is not null) = 1, 'evento añadido enlazado a su corrección');
select test.ok((select count(*) from public.audit_log where entity = 'attendance_corrections') = 2, 'correcciones auditadas');
select test.ok(public.issue_device_activation_code('d0000000-0000-4000-8000-000000000001') ~ '^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$', 'código de activación emitido con formato');

-- ---------- Traslado y baja ----------
select public.transfer_employee('a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'permanent', now(), null, 'Traslado a tienda A2');
select test.ok((select count(*) from public.employee_store_assignments where employee_id = 'a3000000-0000-4000-8000-000000000001' and revoked_at is null and (valid_to is null or valid_to > now())) = 1, 'traslado deja una sola asignación vigente');
select public.set_employee_status('a3000000-0000-4000-8000-000000000002', 'terminated', 'Fin de contrato');
select test.ok(not exists (select 1 from public.employee_store_assignments where employee_id = 'a3000000-0000-4000-8000-000000000002' and revoked_at is null), 'baja revoca asignaciones');
select test.ok((select count(*) from public.employee_status_history where employee_id = 'a3000000-0000-4000-8000-000000000002') = 2, 'historial de estado registrado');
select test.reset();

-- ---------- Roster ----------
set role service_role;
select test.ok((select count(*) from private.device_roster('d0000000-0000-4000-8000-000000000001', 168)) = 0, 'tras el traslado, el teléfono de A1 ya no recibe a Ana');
reset role;
insert into public.devices (id, organization_id, store_id, label, status, activated_at) values
  ('d0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000000', 'a2000000-0000-4000-8000-000000000002', 'Teléfono A2', 'active', now());
set role service_role;
select test.ok((select display_name from private.device_roster('d0000000-0000-4000-8000-000000000003', 168)) = 'Ana P.', 'el teléfono de A2 recibe a Ana sin reenrolar (nombre minimizado)');
reset role;
\echo 'Todas las pruebas SQL superadas'
