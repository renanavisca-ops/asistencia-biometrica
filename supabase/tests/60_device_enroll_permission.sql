-- Permiso de enrolamiento revocable e invitación de administradores.
\set QUIET on
\pset tuples_only on
\pset format unaligned
select test.as_user('00000000-0000-4000-8000-00000000000b');
select test.ok(public.can_invite_admin('a0000000-0000-4000-8000-000000000000', 'central_admin'), 'admin central puede invitar en su organización');
select test.ok(not public.can_invite_admin('b0000000-0000-4000-8000-000000000000', 'central_admin'), 'admin central no invita en otra organización');
select test.ok(not public.can_invite_admin(null, 'superadmin'), 'admin central no puede crear superadministradores');
-- Retirar el permiso del teléfono invalida la sesión de enrolamiento al instante.
select public.set_device_can_enroll('d0000000-0000-4000-8000-0000000000e1', false);
select test.ok(test.raises($$select public.enroll_biometric((select id from public.employees where employee_code like '%' limit 1), gen_random_uuid(), 'a2000000-0000-4000-8000-000000000009','documento',array['AACAPwAAAAAAAAAA','AACAPwAAAAAAAAAA','AACAPwAAAAAAAAAA'],'{}',true,0.9,'c0000000-0000-4000-8000-000000000001',null)$$), 'permiso retirado → enrolamiento bloqueado');
select test.reset();
select test.ok(private.issue_enroll_ticket('d0000000-0000-4000-8000-0000000000e1') is null, 'permiso retirado → el teléfono no obtiene nuevas autorizaciones');
select test.ok((select bool_and(revoked_at is not null) from private.enroll_tickets where device_id = 'd0000000-0000-4000-8000-0000000000e1'), 'autorizaciones abiertas revocadas');
set role service_role;
create temp table pull60 as select private.device_pull('d0000000-0000-4000-8000-0000000000e1', '{}'::uuid[]) p;
select test.ok((select (p -> 'device' ->> 'canEnroll')::boolean from pull60) = false, 'el teléfono recibe su permiso en la sincronización');
reset role;
-- Alta de administrador invitado (lo llama la Edge Function admin-invite con service_role).
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000f1', 'nuevo@x');
set role service_role;
select test.ok(private.register_invited_admin('00000000-0000-4000-8000-0000000000f1', 'Nuevo Admin', 'Nuevo@X ', 'central_admin', 'a0000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-00000000000b') is not null, 'invitado registrado con su rol');
select test.ok(private.register_invited_admin('00000000-0000-4000-8000-0000000000f1', 'Nuevo Admin', 'nuevo@x', 'central_admin', 'a0000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-00000000000b') is null, 'reinvitar no duplica el rol');
reset role;
select test.ok((select email from public.admins where user_id = '00000000-0000-4000-8000-0000000000f1') = 'nuevo@x', 'correo normalizado');
select test.ok(exists (select 1 from public.audit_log where action = 'invite_admin'), 'invitación auditada');
\echo 'Pruebas de permiso de enrolamiento e invitaciones superadas'
