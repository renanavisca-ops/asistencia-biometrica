-- Activación de dispositivos, desafíos, enrolamiento central cifrado, roster y revocaciones.
-- Reutiliza los datos de 10_rls_and_ingest.sql (se ejecuta en la misma base).
\set QUIET on
\pset tuples_only on
\pset format unaligned
insert into public.devices (id, organization_id, store_id, label) values
  ('d0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000000', 'a2000000-0000-4000-8000-000000000002', 'Teléfono A2 nuevo');

select test.as_user('00000000-0000-4000-8000-00000000000b');
select public.issue_device_activation_code('d0000000-0000-4000-8000-000000000004') as code \gset
select test.reset();

set role service_role;
select test.ok((private.activate_device('AAAA-BBBB-CCCC', 'x', 'android', '14', '0.1.0', 'Pixel', 'android_keystore') ->> 'ok') = 'false', 'código inválido rechazado');
select test.ok(exists (select 1 from public.security_events where kind = 'activation_failed'), 'intento fallido registrado');
create temp table act as select private.activate_device(lower(:'code'), 'MCowBQYDK2VwAyEAabcdefghijklmnopqrstuvwx123', 'android', '14', '0.1.0', 'Pixel 8', 'android_keystore') r;
select test.ok((select r ->> 'ok' from act) = 'true' and (select (r ->> 'nextDeviceSeq')::int from act) = 1, 'activación con código válido (insensible a mayúsculas/guiones)');
select test.ok((private.activate_device(:'code', 'MCowBQYDK2VwAyEAabcdefghijklmnopqrstuvwx124', 'android', '14', '0.1.0', 'Pixel 8', 'software') ->> 'error') = 'invalid_code', 'el código es de un solo uso');
select private.issue_challenge('d0000000-0000-4000-8000-000000000004') as ch \gset
select test.ok(private.consume_challenge('d0000000-0000-4000-8000-000000000004', :'ch') = 'MCowBQYDK2VwAyEAabcdefghijklmnopqrstuvwx123', 'desafío devuelve la clave pública activa');
select test.ok(private.consume_challenge('d0000000-0000-4000-8000-000000000004', :'ch') is null, 'desafío de un solo uso');
select test.ok(private.consume_challenge('d0000000-0000-4000-8000-000000000001', private.issue_challenge('d0000000-0000-4000-8000-000000000004')) is null, 'desafío ligado a su dispositivo');
reset role;

-- Enrolamiento central
select test.as_user('00000000-0000-4000-8000-00000000000c');
select test.ok(test.raises($$select public.enroll_biometric('a3000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000009','documento',array['AACAPwAAAAAAAAAA','AACAPwAAAAAAAAAA','AACAPwAAAAAAAAAA'],'{}',true,0.9,'c0000000-0000-4000-8000-000000000001',null)$$), 'supervisor no puede enrolar');
select test.reset();
select test.as_user('00000000-0000-4000-8000-00000000000b');
select test.ok(test.raises($$select public.enroll_biometric('a3000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','documento',array['AACAPwAAAAAAAAAA','AACAPwAAAAAAAAAA','AACAPwAAAAAAAAAA'],'{}',true,0.9,'c0000000-0000-4000-8000-000000000001',null)$$), 'no se enrola en una tienda (solo sede central)');
select test.ok(test.raises($$select public.enroll_biometric('a3000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000009','documento',array['AACAPwAAAAAAAAAA','AACAPwAAAAAAAAAA','AACAPwAAAAAAAAAA'],'{}',false,0.1,'c0000000-0000-4000-8000-000000000001',null)$$), 'sin prueba de vida superada no hay enrolamiento');
select test.ok(test.raises($$select public.enroll_biometric('a3000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000009','documento',array['AACAPwAAAAAAAAAA'],'{}',true,0.9,'c0000000-0000-4000-8000-000000000001',null)$$), 'mínimo 3 muestras');
select test.ok(test.raises($$select public.enroll_biometric('a3000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000009','documento',array['AAAA','AAAA','AAAA'],'{}',true,0.9,'c0000000-0000-4000-8000-000000000001',null)$$), 'dimensión de vector validada');
select test.ok(test.raises($$select public.enroll_biometric('a3000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000009','documento',array['AACAPwAAAAAAAAAA','AACAPwAAAAAAAAAA','AACAPwAAAAAAAAAA'],'{}',true,0.9,'c0000000-0000-4000-8000-000000000001',null)$$), 'sin verificar el documento no hay enrolamiento');
select test.ok(public.verify_employee_document('a3000000-0000-4000-8000-000000000001', '1234567890123') ->> 'reason' = 'no_document', 'empleado sin documento registrado: no se puede verificar');
select public.set_employee_document('a3000000-0000-4000-8000-000000000001', 'DPI', 'GT', '1234 56789 0123', 'prueba automatizada') is null;
select test.ok(public.verify_employee_document('a3000000-0000-4000-8000-000000000001', '9999999999999') ->> 'reason' = 'mismatch', 'número distinto: rechazado');
select test.ok((public.verify_employee_document('a3000000-0000-4000-8000-000000000001', '1234567890123') ->> 'ok')::boolean, 'número correcto (sin espacios): verificado');
-- [1,0,0] y [0,1,0] como float32 little-endian
select test.ok(public.enroll_biometric('a3000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000009','documento_presencial',
  array['AACAPwAAAAAAAAAA','AAAAAAAAgD8AAAAA','AACAPwAAAAAAAAAA'],'{"brightness":0.6}',true,0.95,'c0000000-0000-4000-8000-000000000001',null) is not null, 'enrolamiento válido en sede central');
select test.ok((select count(*) from public.biometric_enrollments where employee_id = 'a3000000-0000-4000-8000-000000000001' and status = 'superseded') = 1, 'el enrolamiento anterior queda sustituido');
select test.reset();

set role service_role;
select test.ok(test.raises($$select extensions.pgp_sym_decrypt(ciphertext, 'clave-incorrecta-de-prueba-0000000000') from private.biometric_template_versions limit 1$$)
  and (select count(*) from private.biometric_template_versions where position(decode('AACAPwAAAAAAAAAA', 'base64') in ciphertext) > 0) = 0, 'plantillas cifradas en reposo (no descifrables sin la clave de Vault)');
create temp table pull1 as select private.device_pull('d0000000-0000-4000-8000-000000000004', array['a3000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000002']::uuid[]) p;
select test.ok((select jsonb_array_length(p -> 'roster') from pull1) = 1, 'roster de A2 contiene a Ana');
select test.ok((select p -> 'roster' -> 0 -> 'templates' -> 1 ->> 'vectorB64' from pull1) in ('AACAPwAAAAAAAAAA','AAAAAAAAgD8AAAAA'), 'plantilla descifrada para el dispositivo autorizado');
select test.ok((select jsonb_array_length(p -> 'roster' -> 0 -> 'templates') from pull1) = 3, 'solo plantillas del enrolamiento vigente');
select test.ok((select p -> 'revokedEmployeeIds' ->> 0 from pull1) = 'a3000000-0000-4000-8000-000000000002', 'empleado dado de baja → ordenar borrado local');
select test.ok((select p -> 'roster' -> 0 ->> 'lastEvent' from pull1) is not null, 'el roster incluye el último evento (coherencia entre teléfonos)');
reset role;

-- Bloqueo de dispositivo
select test.as_user('00000000-0000-4000-8000-00000000000b');
select public.set_device_status('d0000000-0000-4000-8000-000000000004', 'blocked', 'Teléfono extraviado');
select test.reset();
set role service_role;
select test.ok(private.issue_challenge('d0000000-0000-4000-8000-000000000004') is null, 'dispositivo bloqueado no obtiene desafíos');
select test.ok((select jsonb_array_length(p -> 'roster') from (select private.device_pull('d0000000-0000-4000-8000-000000000004', array['a3000000-0000-4000-8000-000000000001']::uuid[]) p) x) = 0, 'dispositivo bloqueado recibe roster vacío + orden de borrado');
reset role;

-- Derecho de supresión biométrica (separación de funciones)
select test.as_user('00000000-0000-4000-8000-00000000000b');
insert into public.retention_requests (organization_id, employee_id, kind, reason, requested_by)
values ('a0000000-0000-4000-8000-000000000000', 'a3000000-0000-4000-8000-000000000001', 'erase_biometrics', 'Solicitud de la titular', '00000000-0000-4000-8000-00000000000b');
select test.ok(test.raises($$select public.decide_retention_request((select id from public.retention_requests limit 1), true, 'x')$$), 'quien solicita no puede aprobar');
select test.reset();
select test.as_user('00000000-0000-4000-8000-00000000000a');
select public.decide_retention_request((select id from public.retention_requests limit 1), true, 'Aprobado por superadmin');
select test.reset();
set role service_role;
select test.ok((select count(*) from private.biometric_template_versions where employee_id = 'a3000000-0000-4000-8000-000000000001') = 0, 'plantillas borradas tras supresión');
select test.ok((select jsonb_array_length(p -> 'roster') from (select private.device_pull('d0000000-0000-4000-8000-000000000003', array['a3000000-0000-4000-8000-000000000001']::uuid[]) p) x) = 0
  and (select p -> 'revokedEmployeeIds' ->> 0 from (select private.device_pull('d0000000-0000-4000-8000-000000000003', array['a3000000-0000-4000-8000-000000000001']::uuid[]) p) x) = 'a3000000-0000-4000-8000-000000000001', 'tras supresión el teléfono recibe orden de borrado');
reset role;
\echo 'Pruebas de dispositivos y biometría superadas'
