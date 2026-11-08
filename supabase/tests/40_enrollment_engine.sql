-- Decodificación float32, control de duplicados y sede central.
\set QUIET on
\pset tuples_only on
\pset format unaligned
select test.ok(private.f32le_to_array(decode('AACAPwAAAAAAAADA', 'base64')) = array[1, 0, -2]::float8[], 'float32 LE decodificado (1, 0, -2)');
select test.ok(abs((private.f32le_to_array(decode('2w9JQA==', 'base64')))[1] - 3.1415927) < 1e-6, 'float32 pi');
select test.ok(abs(private.cosine(array[1,0,0], array[0.6,0.8,0]) - 0.6) < 1e-9, 'coseno');
select test.ok(exists (select 1 from public.model_versions where name = 'sface' and version = '2021dec' and embedding_dim = 128 and status = 'evaluation'), 'modelo sface@2021dec registrado como experimental');

select test.as_user('00000000-0000-4000-8000-00000000000b');
create temp table d1 as select (public.create_employee('a0000000-0000-4000-8000-000000000000', 'Dup', 'Uno', 'DPI', 'GT', '2222222222222', null, 'a2000000-0000-4000-8000-000000000001') ->> 'id')::uuid id;
create temp table d2 as select (public.create_employee('a0000000-0000-4000-8000-000000000000', 'Dup', 'Dos', null, null, null, null, 'a2000000-0000-4000-8000-000000000001') ->> 'id')::uuid id;
insert into public.biometric_consents (organization_id, employee_id, legal_basis, notice_version, accepted_at, recorded_by)
  select 'a0000000-0000-4000-8000-000000000000'::uuid, id, 'consentimiento_expreso', 'v1', now(), '00000000-0000-4000-8000-00000000000b'::uuid from d1 union all
  select 'a0000000-0000-4000-8000-000000000000'::uuid, id, 'consentimiento_expreso', 'v1', now(), '00000000-0000-4000-8000-00000000000b'::uuid from d2;
select test.ok(public.central_store_for('a0000000-0000-4000-8000-000000000000') = 'a2000000-0000-4000-8000-000000000009', 'sede central de la organización');
select test.ok(public.verify_employee_document((select id from d2), '2222222222222') ->> 'reason' = 'no_document', 'd2 sin documento');
select public.set_employee_document((select id from d2), 'DPI', 'GT', '3333333333333', 'prueba automatizada') is null;
select test.ok(public.verify_employee_document((select id from d2), '2222222222222') ->> 'reason' = 'other_employee', 'documento de otro empleado: bloqueado y señalado');
select test.ok(exists (select 1 from public.security_events where kind = 'enroll_document_mismatch'), 'intento registrado como evento de seguridad');
select test.ok((public.verify_employee_document((select id from d1), '2222222222222') ->> 'ok')::boolean, 'd1 verificado');
select public.enroll_biometric((select id from d1), (select id from public.biometric_consents where employee_id = (select id from d1)), 'a2000000-0000-4000-8000-000000000009',
  'documento', array['AACAPwAAAAAAAAAA','AACAPwAAAAAAAAAA','AACAPwAAAAAAAAAA'], '{}', true, 0.9, 'c0000000-0000-4000-8000-000000000001', null) is not null;
select test.ok((select employee_code from public.check_biometric_duplicate((select id from d2), array['AACAPwAAAAAAAAAA'], 'c0000000-0000-4000-8000-000000000001', 0.9)) = (select employee_code from public.employees where id = (select id from d1)),
  'misma cara para otro empleado → duplicado detectado (código del ya enrolado)');
select test.ok(not exists (select 1 from public.check_biometric_duplicate((select id from d2), array['AAAAAAAAgD8AAAAA'], 'c0000000-0000-4000-8000-000000000001', 0.9)), 'cara distinta → sin duplicado');
select test.ok(not exists (select 1 from public.check_biometric_duplicate((select id from d1), array['AACAPwAAAAAAAAAA'], 'c0000000-0000-4000-8000-000000000001', 0.9)), 'reenrolar a la misma persona no se marca como duplicado');
select test.reset();

select test.as_user('00000000-0000-4000-8000-00000000000c');
select test.ok(test.raises($$select * from public.check_biometric_duplicate((select id from d2), array['AACAPwAAAAAAAAAA'], 'c0000000-0000-4000-8000-000000000001', 0.9)$$), 'supervisor no puede consultar duplicados');
select test.reset();
select test.as_user('00000000-0000-4000-8000-00000000000d');
select test.ok(not exists (select 1 from public.check_biometric_duplicate((select id from public.employees where employee_code = 'ORGB-000001'), array['AACAPwAAAAAAAAAA'], 'c0000000-0000-4000-8000-000000000001', 0.5)), 'org B nunca compara contra plantillas de org A');
select test.ok(public.central_store_for('a0000000-0000-4000-8000-000000000000') is null, 'org B no obtiene la sede central de org A');
select test.reset();
\echo 'Pruebas de enrolamiento superadas'
