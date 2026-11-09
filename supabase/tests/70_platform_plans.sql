-- Plataforma: el superadministrador no ve datos de organizaciones; planes, soporte, suspensión, eliminación y registro.
\set QUIET on
\pset tuples_only on
\pset format unaligned
\set SUPER '\'00000000-0000-4000-8000-00000000000a\''
\set CB '\'00000000-0000-4000-8000-00000000000d\''
\set ORGB '\'b0000000-0000-4000-8000-000000000000\''

-- 1. Superadministrador: cifras de plataforma sí, datos de la organización no.
select test.as_user(:SUPER);
select test.ok((select count(*) from public.employees) = 0, 'superadministrador NO ve empleados de las organizaciones');
select test.ok((select count(*) from public.stores) = 0 and (select count(*) from public.attendance_events) = 0, 'ni sucursales ni marcaciones');
select test.ok(test.raises($$insert into public.employees (organization_id, first_name, last_name) values ('b0000000-0000-4000-8000-000000000000', 'X', 'Y')$$), 'ni puede crear empleados');
select test.ok((select employees_active from public.platform_orgs() where id = :ORGB) >= 1, 'pero sí ve cuántos empleados tiene cada organización');
select test.ok((select needed_tier_label from public.platform_orgs() where id = :ORGB) = 'Gratis (1–5 empleados)', 'y el tramo de plan que le corresponde');
select test.reset();
select test.as_user(:CB);
select test.ok(test.raises($$select * from public.platform_orgs()$$), 'una organización no ve la plataforma');
select test.ok(test.raises($$update public.organizations set unlimited = true where id = 'b0000000-0000-4000-8000-000000000000'$$), 'ni puede cambiarse el plan');
update public.organizations set name = 'Org B renombrada' where id = :ORGB;
select test.ok((select name from public.organizations where id = :ORGB) = 'Org B renombrada', 'sí puede cambiar su nombre');
-- 2. Soporte temporal concedido por la organización (solo lectura).
select public.grant_support_access(:ORGB, 2, 'Revisar reporte');
select test.reset();
select test.as_user(:SUPER);
select test.ok((select count(*) from public.employees where organization_id = :ORGB) >= 1, 'con soporte concedido el superadministrador ve los datos');
select test.ok(test.raises($$insert into public.employees (organization_id, first_name, last_name) values ('b0000000-0000-4000-8000-000000000000', 'X', 'Y')$$), 'pero solo lectura');
select test.ok((select count(*) from public.employees where organization_id = 'a0000000-0000-4000-8000-000000000000') = 0, 'y solo de esa organización');
select test.reset();
select test.as_user(:CB);
select public.revoke_support_access(:ORGB);
select test.reset();
select test.as_user(:SUPER);
select test.ok((select count(*) from public.employees) = 0, 'al retirar el soporte deja de ver los datos');
select test.reset();

-- 3. Límite del plan gratuito (5 empleados con rostro).
create temp table emps70 as select gen_random_uuid() id, n from generate_series(1, 6) n;
grant select on emps70 to authenticated;
insert into public.employees (id, organization_id, first_name, last_name) select id, :ORGB, 'E' || n, 'Plan' from emps70;
insert into public.biometric_consents (id, organization_id, employee_id, legal_basis, notice_version, accepted_at, recorded_by)
  select id, :ORGB, id, 'consentimiento_expreso', 'v1', now(), :CB from emps70;
insert into public.biometric_enrollments (organization_id, employee_id, consent_id, enrolled_by, enrolled_at_store_id, identity_verification_method, sample_count, quality, pad_passed, recognition_model_id)
  select :ORGB, id, id, :CB, 'b2000000-0000-4000-8000-000000000001', 'prueba', 3, '{}', true, 'c0000000-0000-4000-8000-000000000001' from emps70 where n <= 4;
select test.as_user(:CB);
select test.ok((public.org_plan_status(:ORGB) -> 'warnings') ? 'near_limit', 'aviso al acercarse al límite (4 de 5)');
select test.reset();
insert into public.biometric_enrollments (organization_id, employee_id, consent_id, enrolled_by, enrolled_at_store_id, identity_verification_method, sample_count, quality, pad_passed, recognition_model_id)
  select :ORGB, id, id, :CB, 'b2000000-0000-4000-8000-000000000001', 'prueba', 3, '{}', true, 'c0000000-0000-4000-8000-000000000001' from emps70 where n = 5;
select test.as_user(:CB);
select test.ok((public.org_plan_status(:ORGB) -> 'warnings') ? 'at_limit', 'aviso de límite alcanzado (5 de 5)');
select test.ok((public.org_plan_status(:ORGB) ->> 'nextPlanLabel') = '6–10 empleados', 'indica el plan siguiente');
create temp table e6 as select id from emps70 where n = 6;
grant select on e6 to authenticated;
select test.ok(test.raises($$select public.enroll_biometric((select id from e6), (select id from e6), 'b2000000-0000-4000-8000-000000000001', 'x', array['AACAPwAAAAAAAAAA','AACAPwAAAAAAAAAA','AACAPwAAAAAAAAAA'], '{}', true, 0.9, 'c0000000-0000-4000-8000-000000000001', null)$$), 'no puede enrolar al sexto sin plan de pago');
select test.reset();
-- El superadministrador asigna plan 6–10 con vencimiento: ya no está en el límite.
select test.as_user(:SUPER);
select test.ok(test.raises($$select public.platform_set_plan('b0000000-0000-4000-8000-000000000000', false, 12, now() + interval '30 days')$$), 'el plan debe ser un tramo válido');
select public.platform_set_plan(:ORGB, false, 10, now() + interval '3 days');
select test.reset();
select test.as_user(:CB);
select test.ok(not (public.org_plan_status(:ORGB) -> 'warnings') ? 'at_limit' and (public.org_plan_status(:ORGB) -> 'warnings') ? 'expiring_soon', 'plan 6–10 activo; aviso de vencimiento próximo');
select test.reset();
-- Membresía vencida: solo lectura y los teléfonos no marcan.
select test.as_user(:SUPER);
select public.platform_set_plan(:ORGB, false, 10, now() - interval '1 day');
select test.reset();
select test.as_user(:CB);
select test.ok((public.org_plan_status(:ORGB) ->> 'access') = 'read_only' and (public.org_plan_status(:ORGB) -> 'warnings') ? 'expired', 'membresía vencida → solo lectura');
select test.ok((select count(*) from public.employees where organization_id = :ORGB) >= 6, 'puede ver y descargar sus datos');
select test.ok(test.raises($$insert into public.employees (organization_id, first_name, last_name) values ('b0000000-0000-4000-8000-000000000000', 'X', 'Y')$$), 'pero no crear ni modificar');
select test.reset();
insert into public.devices (id, organization_id, store_id, label, status, can_enroll, activated_at)
values ('d0000000-0000-4000-8000-0000000000b7', :ORGB, 'b2000000-0000-4000-8000-000000000001', 'Tel B', 'active', true, now());
set role service_role;
select test.ok((private.device_pull('d0000000-0000-4000-8000-0000000000b7', '{}') -> 'device' ->> 'orgAccess') = 'read_only'
  and (private.device_pull('d0000000-0000-4000-8000-0000000000b7', '{}') -> 'device' ->> 'canEnroll') = 'false', 'el teléfono recibe «solo lectura» y deja de enrolar/marcar');
reset role;
-- Sin límite (p. ej. la organización propia).
select test.as_user(:SUPER);
select public.platform_set_plan(:ORGB, true, null, null);
select test.reset();
select test.as_user(:CB);
select test.ok((public.org_plan_status(:ORGB) ->> 'access') = 'full' and (public.org_plan_status(:ORGB) -> 'limit') = 'null'::jsonb, 'sin límite: acceso completo y sin tope');
select test.reset();

-- 4. Suspensión por el superadministrador.
select test.as_user(:CB);
select test.ok(test.raises($$select public.platform_set_status('b0000000-0000-4000-8000-000000000000', 'suspended', 'falta de pago')$$), 'la organización no puede cambiar su estado de plataforma');
select test.reset();
select test.as_user(:SUPER);
select public.platform_set_status(:ORGB, 'suspended', 'Falta de pago');
select test.reset();
select test.as_user(:CB);
select test.ok((public.org_plan_status(:ORGB) ->> 'access') = 'read_only', 'suspendida → solo lectura');
select test.reset();
select test.as_user(:SUPER);
select public.platform_set_status(:ORGB, 'active', null);
select test.reset();

-- 5. Eliminación de la cuenta con 90 días de conservación.
select test.as_user(:CB);
select test.ok(test.raises($$select public.request_org_deletion('b0000000-0000-4000-8000-000000000000', 'otro nombre')$$), 'exige escribir el nombre exacto');
select test.ok(public.request_org_deletion(:ORGB, 'org b renombrada') between now() + interval '89 days' and now() + interval '91 days', 'eliminación programada a 90 días');
select test.ok((public.org_plan_status(:ORGB) ->> 'access') = 'read_only', 'durante esos 90 días: solo lectura');
select public.cancel_org_deletion(:ORGB);
select test.ok((public.org_plan_status(:ORGB) ->> 'status') = 'active', 'puede volver antes de los 90 días');
select test.reset();
-- Borrado definitivo al vencer el plazo (tarea programada).
create temp table o70 as select private.create_org('Org temporal', 'SV', 'platform', false, null) id;
insert into public.employees (organization_id, first_name, last_name) select id, 'Temp', 'Oral' from o70;
update public.organizations set status = 'pending_deletion', deletion_due_at = now() - interval '1 minute' where id = (select id from o70);
select test.ok(private.purge_due_orgs() = 1, 'tarea programada: una organización vencida');
select test.ok( not exists (select 1 from public.organizations where id = (select id from o70))
  and not exists (select 1 from public.employees where organization_id = (select id from o70)), 'a los 90 días se borra todo');

-- 6. Registro desde la app (correo confirmado → organización + administradora central).
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000f7', 'duena@nueva.com', '{"signup": {"org_name": "Ferretería Nueva", "country": "HN", "admin_name": "Dueña", "terms_version": "v1"}}', null);
select test.as_user('00000000-0000-4000-8000-0000000000f7', 'aal1');
select test.ok(test.raises($$select public.complete_signup()$$), 'sin confirmar el correo no se crea la organización');
select test.reset();
update auth.users set email_confirmed_at = now() where id = '00000000-0000-4000-8000-0000000000f7';
select test.as_user('00000000-0000-4000-8000-0000000000f7', 'aal1');
select test.ok((public.complete_signup() ->> 'created')::boolean, 'correo confirmado → organización creada');
select test.ok(not (public.complete_signup() ->> 'created')::boolean, 'no se duplica');
select test.reset();
select test.ok((select o.country_code || '|' || o.created_via || '|' || o.terms_version || '|' || r.timezone from public.organizations o join public.regions r on r.organization_id = o.id
                where o.name = 'Ferretería Nueva') = 'HN|app_signup|v1|America/Tegucigalpa', 'país, términos aceptados y región con su zona horaria');
select test.ok(exists (select 1 from public.admin_role_grants g join public.organizations o on o.id = g.organization_id
                       where g.user_id = '00000000-0000-4000-8000-0000000000f7' and g.role = 'central_admin' and o.name = 'Ferretería Nueva'), 'la persona queda como administradora central');

-- 7. Organización propia del dueño (sin límite) y acceso a sus datos como administrador de ella.
select test.as_user(:SUPER);
create temp table own70 as select public.platform_create_own_org('Mi empresa', 'GT') id;
select test.reset();
select test.as_user(:SUPER);
select test.ok((select unlimited from public.platform_orgs() where id = (select id from own70)), 'organización propia sin límite');
select test.ok((select count(*) from public.regions where organization_id = (select id from own70)) = 1, 'y la administra como cualquier organización');
select test.reset();
\echo 'Pruebas de plataforma y planes superadas'
