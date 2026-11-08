-- Códigos automáticos por organización y documento cifrado anti-duplicados.
\set QUIET on
\pset tuples_only on
\pset format unaligned
update public.organizations set employee_code_prefix = 'ORGA' where id = 'a0000000-0000-4000-8000-000000000000';
update public.organizations set employee_code_prefix = 'ORGB' where id = 'b0000000-0000-4000-8000-000000000000';

select test.as_user('00000000-0000-4000-8000-00000000000b');
create temp table e1 as select public.create_employee('a0000000-0000-4000-8000-000000000000', 'Carla', 'Ruiz', 'DPI', 'GT', '2563 41234 0101', current_date, 'a2000000-0000-4000-8000-000000000001') r;
create temp table e2 as select public.create_employee('a0000000-0000-4000-8000-000000000000', 'Pedro', 'Sol', 'CEDULA', 'CR', '1-1234-0567', null, null) r;
select test.ok((select r ->> 'employeeCode' from e1) = 'ORGA-000001' and (select r ->> 'employeeCode' from e2) = 'ORGA-000002', 'códigos consecutivos automáticos por organización');
select test.ok((select document_last4 || document_type || document_country from public.employees where id = (select (r ->> 'id')::uuid from e1)) = '0101DPIGT', 'el panel solo ve tipo, país y últimos 4');
select test.ok(exists (select 1 from public.employee_store_assignments where employee_id = (select (r ->> 'id')::uuid from e1)), 'alta con sede asignada');
select test.ok(test.raises($$select public.create_employee('a0000000-0000-4000-8000-000000000000', 'Otra', 'Persona', 'DPI', 'GT', '2563412340101', null, null)$$), 'DPI duplicado (con otro formato) rechazado');
select test.ok(test.raises($$select public.create_employee('a0000000-0000-4000-8000-000000000000', 'X', 'Y', 'DPI', 'GT', '12345', null, null)$$), 'DPI con longitud inválida rechazado');
select test.ok(test.raises($$update public.employees set employee_code = 'X-1' where employee_code = 'ORGA-000001'$$), 'código no editable');
select test.ok(test.raises($$insert into public.employees (organization_id, first_name, last_name) values ('a0000000-0000-4000-8000-000000000000', 'a', 'b')$$), 'alta directa por API cerrada');
select test.ok(test.raises($$select * from private.employee_documents$$), 'documentos cifrados inaccesibles directamente');
select test.ok(test.raises($$select public.reveal_employee_document((select (r ->> 'id')::uuid from e1), 'corto')$$), 'ver documento exige motivo');
select test.ok(public.reveal_employee_document((select (r ->> 'id')::uuid from e1), 'Verificación de planilla mensual') = '2563412340101', 'administrador central puede ver el documento completo');
select test.ok(exists (select 1 from public.audit_log where action = 'reveal_employee_document'), 'consulta del documento auditada');
update public.employees set first_name = 'Carla María' where employee_code = 'ORGA-000001';
select test.ok((select first_name from public.employees where employee_code = 'ORGA-000001') = 'Carla María', 'edición de nombre permitida');
select test.reset();

-- Otra organización: su propia numeración y el mismo DPI no colisiona entre organizaciones.
select test.as_user('00000000-0000-4000-8000-00000000000d');
select test.ok((public.create_employee('b0000000-0000-4000-8000-000000000000', 'Carla', 'Ruiz', 'DPI', 'GT', '2563412340101', null, null) ->> 'employeeCode') = 'ORGB-000001', 'numeración independiente por organización y sin cruce de documentos');
select test.ok(test.raises($$select public.create_employee('a0000000-0000-4000-8000-000000000000', 'X', 'Y', 'DPI', 'GT', '1111111111111', null, null)$$), 'admin de B no crea empleados en A');
select test.reset();

select test.as_user('00000000-0000-4000-8000-00000000000c');
select test.ok(test.raises($$select public.reveal_employee_document((select (r ->> 'id')::uuid from e1), 'Supervisor quiere ver el DPI')$$), 'supervisor no puede ver documentos');
select test.reset();

set role service_role;
select test.ok((select count(*) from private.employee_documents where position(convert_to('2563412340101', 'UTF8') in ciphertext) > 0) = 0, 'documento cifrado en reposo');
reset role;
\echo 'Pruebas de códigos y documentos superadas'
