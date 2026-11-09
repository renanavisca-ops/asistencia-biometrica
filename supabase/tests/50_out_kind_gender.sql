-- Salida elegida (almuerzo / fin de turno) y género para el saludo.
\set QUIET on
\pset tuples_only on
\pset format unaligned
update public.employees set gender = 'F' where id = 'a3000000-0000-4000-8000-000000000001';
select test.ok(test.raises($$update public.employees set gender = 'X' where id = 'a3000000-0000-4000-8000-000000000001'$$), 'género restringido a F/M (o vacío)');
set role service_role;
create temp table acks50 as select private.ingest_device_events('d0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000050', $$[
  {"id":"e5000000-0000-4000-8000-000000000001","storeId":"a2000000-0000-4000-8000-000000000001","employeeId":"a3000000-0000-4000-8000-000000000001","eventType":"IN","deviceSeq":10,"occurredAt":"2026-11-09T14:00:00Z","tzOffsetMin":-360,"monotonicMs":1,"bootId":"z","clockFlags":[],"decisionFlags":[],"capturedOffline":true,"policyVersion":1,"appVersion":"0.5.0","signature":"sig"},
  {"id":"e5000000-0000-4000-8000-000000000002","storeId":"a2000000-0000-4000-8000-000000000001","employeeId":"a3000000-0000-4000-8000-000000000001","eventType":"OUT","deviceSeq":11,"occurredAt":"2026-11-09T18:00:00Z","tzOffsetMin":-360,"monotonicMs":2,"bootId":"z","clockFlags":[],"decisionFlags":["out_break"],"capturedOffline":true,"policyVersion":1,"appVersion":"0.5.0","signature":"sig"},
  {"id":"e5000000-0000-4000-8000-000000000003","storeId":"a2000000-0000-4000-8000-000000000001","employeeId":"a3000000-0000-4000-8000-000000000001","eventType":"IN","deviceSeq":12,"occurredAt":"2026-11-09T19:00:00Z","tzOffsetMin":-360,"monotonicMs":3,"bootId":"z","clockFlags":[],"decisionFlags":["in_after_break"],"capturedOffline":true,"policyVersion":1,"appVersion":"0.5.0","signature":"sig"},
  {"id":"e5000000-0000-4000-8000-000000000004","storeId":"a2000000-0000-4000-8000-000000000001","employeeId":"a3000000-0000-4000-8000-000000000001","eventType":"OUT","deviceSeq":13,"occurredAt":"2026-11-09T23:00:00Z","tzOffsetMin":-360,"monotonicMs":4,"bootId":"z","clockFlags":[],"decisionFlags":["out_end"],"capturedOffline":true,"policyVersion":1,"appVersion":"0.5.0","signature":"sig"}
]$$::jsonb) a;
select test.ok((select out_kind from public.attendance_sessions where out_event_id = 'e5000000-0000-4000-8000-000000000002') = 'break', 'sesión cerrada por salida a almuerzo → out_kind break');
select test.ok((select out_kind from public.attendance_sessions where out_event_id = 'e5000000-0000-4000-8000-000000000004') = 'end', 'sesión cerrada por fin de turno → out_kind end');
select test.ok((select out_kind from public.attendance_sessions where out_event_id = 'e1000000-0000-4000-8000-000000000002') is null, 'salidas antiguas sin elección → out_kind vacío (se deduce por tiempo)');
reset role;
-- Las pruebas anteriores retiraron su consentimiento/enrolamiento: se crea uno vigente para esta prueba.
insert into public.biometric_consents (id, organization_id, employee_id, legal_basis, notice_version, accepted_at, recorded_by)
values ('c5000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000000', 'a3000000-0000-4000-8000-000000000001', 'consentimiento_expreso', 'v1', now(), '00000000-0000-4000-8000-00000000000b');
insert into public.biometric_enrollments (organization_id, employee_id, consent_id, enrolled_by, enrolled_at_store_id, identity_verification_method, sample_count, quality, pad_passed, recognition_model_id)
values ('a0000000-0000-4000-8000-000000000000', 'a3000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-00000000000b', 'a2000000-0000-4000-8000-000000000009', 'prueba', 3, '{}', true, 'c0000000-0000-4000-8000-000000000001');
-- Teléfono activo en la sede vigente de la empleada (en 10_ se trasladó de sede).
insert into public.devices (id, organization_id, store_id, label, status, activated_at)
select 'd0000000-0000-4000-8000-000000000050', 'a0000000-0000-4000-8000-000000000000', a.store_id, 'Tel prueba 50', 'active', now()
  from public.employee_store_assignments a where a.employee_id = 'a3000000-0000-4000-8000-000000000001' and a.revoked_at is null
   and (a.valid_to is null or a.valid_to > now()) limit 1;
set role service_role;
create temp table pull50 as select private.device_pull('d0000000-0000-4000-8000-000000000050', '{}'::uuid[]) p;
select test.ok((select x ->> 'gender' from pull50, jsonb_array_elements(p -> 'roster') x where x ->> 'employeeId' = 'a3000000-0000-4000-8000-000000000001') = 'F', 'el roster lleva el género para el saludo');
select test.ok((select x -> 'lastEvent' ->> 'outKind' from pull50, jsonb_array_elements(p -> 'roster') x where x ->> 'employeeId' = 'a3000000-0000-4000-8000-000000000001') = 'end', 'el roster lleva el tipo de la última salida');
reset role;
\echo 'Pruebas de salida elegida y género superadas'
