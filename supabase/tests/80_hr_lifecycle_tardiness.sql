-- Ampliación administrativa: alta de organizaciones desde la plataforma, ciclo laboral, expediente/disciplina,
-- horarios opcionales, tardanzas, alertas sin duplicados y aislamiento.
\set QUIET on
\pset tuples_only on
\pset format unaligned
\set SUPER '\'00000000-0000-4000-8000-00000000000a\''
\set CA '\'00000000-0000-4000-8000-00000000000b\''
\set SV '\'00000000-0000-4000-8000-00000000000c\''
\set CB '\'00000000-0000-4000-8000-00000000000d\''
\set ORGA '\'a0000000-0000-4000-8000-000000000000\''
\set A1 '\'a2000000-0000-4000-8000-000000000001\''
\set A2 '\'a2000000-0000-4000-8000-000000000002\''
\set EMP '\'a8000000-0000-4000-8000-000000000001\''
\set EMP2 '\'a8000000-0000-4000-8000-000000000002\''
update public.organizations set unlimited = true where id = :ORGA;

-- 1. La plataforma crea organizaciones (además del registro desde la app) con límites y zona horaria.
select test.as_user(:SUPER);
create temp table neworg as select public.platform_create_org('Cliente Manual', 'CR', 'America/Costa_Rica', 20, false, now() + interval '30 days',
  'Cliente Manual S.A.', '3-101-000', 'admin@cliente.com', '+506 0000') id;
select test.ok((select max_employees from public.platform_orgs() where id = (select id from neworg)) = 20
  and (select timezone from public.platform_orgs() where id = (select id from neworg)) = 'America/Costa_Rica'
  and (select created_via from public.platform_orgs() where id = (select id from neworg)) = 'platform', 'la plataforma crea la organización con límite, país y zona horaria');
select test.ok(public.can_invite_admin((select id from neworg), 'central_admin'), 'la plataforma puede asignar su administrador principal');
select test.ok((select count(*) from public.employees where organization_id = (select id from neworg)) = 0, 'pero no ve sus datos');
select public.platform_update_org((select id from neworg), 'Cliente Manual S.A.', null, null, null, null, false, 20, now() + interval '30 days', 1, 1, '{"hr": false}');
select test.reset();
insert into public.stores (organization_id, region_id, code, name, timezone)
select o.id, r.id, 'S1', 'Sucursal 1', r.timezone from neworg o join public.regions r on r.organization_id = o.id;
select test.ok(test.raises($$insert into public.stores (organization_id, region_id, code, name, timezone) select o.id, r.id, 'S2', 'Sucursal 2', r.timezone from neworg o join public.regions r on r.organization_id = o.id$$),
  'límite de sucursales validado en el servidor');
select test.ok(not private.feature_on((select id from neworg), 'hr') and private.feature_on((select id from neworg), 'alerts'), 'módulos habilitables por organización');
-- Separación de contextos: una cuenta de superadministrador no se asigna a una organización ajena desde la plataforma.
grant select on neworg to service_role;
set role service_role;
select test.ok(test.raises(format($$select private.register_invited_admin(%L, 'Super', 'super@x', 'central_admin', %L, %L)$$,
  '00000000-0000-4000-8000-00000000000a', (select id from neworg), '00000000-0000-4000-8000-00000000000a')), 'el superadministrador no se convierte en administrador de un cliente');
reset role;

-- 2. Ciclo laboral: alta → baja (motivo) → historial intacto → recontratación con período nuevo.
insert into public.employees (id, organization_id, first_name, last_name, hired_on) values (:EMP, :ORGA, 'Juan', 'Pérez', '2026-09-01');
insert into public.employee_store_assignments (organization_id, employee_id, store_id, valid_from) values (:ORGA, :EMP, :A1, '2026-09-01T00:00:00Z');
insert into public.employees (id, organization_id, first_name, last_name, hired_on) values (:EMP2, :ORGA, 'Rosa', 'Díaz', '2026-09-01');
insert into public.employee_store_assignments (organization_id, employee_id, store_id, valid_from) values (:ORGA, :EMP2, :A2, '2026-09-01T00:00:00Z');
select test.ok((select count(*) from public.employment_periods where employee_id = :EMP and period_no = 1 and started_on = '2026-09-01' and ended_on is null) = 1, 'el alta abre el período 1 con su fecha de ingreso');

-- 3. Horarios OPCIONALES: sin horario no hay tardanzas aunque marque tarde.
set role service_role;
select private.ingest_device_events('d0000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000001', $$[
  {"id":"e8100000-0000-4000-8000-000000000001","storeId":"a2000000-0000-4000-8000-000000000001","employeeId":"a8000000-0000-4000-8000-000000000001","eventType":"IN","deviceSeq":901,"occurredAt":"2026-10-05T14:20:00Z","tzOffsetMin":-360,"monotonicMs":1,"bootId":"h","clockFlags":[],"decisionFlags":[],"capturedOffline":true,"policyVersion":1,"appVersion":"0.7.0","signature":"sig"},
  {"id":"e8100000-0000-4000-8000-000000000002","storeId":"a2000000-0000-4000-8000-000000000001","employeeId":"a8000000-0000-4000-8000-000000000001","eventType":"OUT","deviceSeq":902,"occurredAt":"2026-10-05T18:00:00Z","tzOffsetMin":-360,"monotonicMs":2,"bootId":"h","clockFlags":[],"decisionFlags":["out_break"],"capturedOffline":true,"policyVersion":1,"appVersion":"0.7.0","signature":"sig"},
  {"id":"e8100000-0000-4000-8000-000000000003","storeId":"a2000000-0000-4000-8000-000000000001","employeeId":"a8000000-0000-4000-8000-000000000001","eventType":"IN","deviceSeq":903,"occurredAt":"2026-10-05T19:00:00Z","tzOffsetMin":-360,"monotonicMs":3,"bootId":"h","clockFlags":[],"decisionFlags":["in_after_break"],"capturedOffline":true,"policyVersion":1,"appVersion":"0.7.0","signature":"sig"},
  {"id":"e8100000-0000-4000-8000-000000000004","storeId":"a2000000-0000-4000-8000-000000000001","employeeId":"a8000000-0000-4000-8000-000000000001","eventType":"OUT","deviceSeq":904,"occurredAt":"2026-10-05T23:00:00Z","tzOffsetMin":-360,"monotonicMs":4,"bootId":"h","clockFlags":[],"decisionFlags":["out_end"],"capturedOffline":true,"policyVersion":1,"appVersion":"0.7.0","signature":"sig"},
  {"id":"e8100000-0000-4000-8000-000000000005","storeId":"a2000000-0000-4000-8000-000000000001","employeeId":"a8000000-0000-4000-8000-000000000001","eventType":"IN","deviceSeq":905,"occurredAt":"2026-10-06T14:10:00Z","tzOffsetMin":-360,"monotonicMs":5,"bootId":"h","clockFlags":[],"decisionFlags":[],"capturedOffline":true,"policyVersion":1,"appVersion":"0.7.0","signature":"sig"},
  {"id":"e8100000-0000-4000-8000-000000000006","storeId":"a2000000-0000-4000-8000-000000000001","employeeId":"a8000000-0000-4000-8000-000000000001","eventType":"OUT","deviceSeq":906,"occurredAt":"2026-10-06T23:00:00Z","tzOffsetMin":-360,"monotonicMs":6,"bootId":"h","clockFlags":[],"decisionFlags":["out_end"],"capturedOffline":true,"policyVersion":1,"appVersion":"0.7.0","signature":"sig"},
  {"id":"e8100000-0000-4000-8000-000000000007","storeId":"a2000000-0000-4000-8000-000000000001","employeeId":"a8000000-0000-4000-8000-000000000001","eventType":"IN","deviceSeq":907,"occurredAt":"2026-10-07T14:03:00Z","tzOffsetMin":-360,"monotonicMs":7,"bootId":"h","clockFlags":[],"decisionFlags":[],"capturedOffline":true,"policyVersion":1,"appVersion":"0.7.0","signature":"sig"},
  {"id":"e8100000-0000-4000-8000-000000000008","storeId":"a2000000-0000-4000-8000-000000000001","employeeId":"a8000000-0000-4000-8000-000000000001","eventType":"OUT","deviceSeq":908,"occurredAt":"2026-10-07T23:00:00Z","tzOffsetMin":-360,"monotonicMs":8,"bootId":"h","clockFlags":[],"decisionFlags":["out_end"],"capturedOffline":true,"policyVersion":1,"appVersion":"0.7.0","signature":"sig"},
  {"id":"e8100000-0000-4000-8000-000000000009","storeId":"a2000000-0000-4000-8000-000000000001","employeeId":"a8000000-0000-4000-8000-000000000001","eventType":"IN","deviceSeq":909,"occurredAt":"2026-10-08T14:30:00Z","tzOffsetMin":-360,"monotonicMs":9,"bootId":"h","clockFlags":[],"decisionFlags":[],"capturedOffline":true,"policyVersion":1,"appVersion":"0.7.0","signature":"sig"},
  {"id":"e8100000-0000-4000-8000-000000000010","storeId":"a2000000-0000-4000-8000-000000000001","employeeId":"a8000000-0000-4000-8000-000000000001","eventType":"OUT","deviceSeq":910,"occurredAt":"2026-10-08T23:00:00Z","tzOffsetMin":-360,"monotonicMs":10,"bootId":"h","clockFlags":[],"decisionFlags":["out_end"],"capturedOffline":true,"policyVersion":1,"appVersion":"0.7.0","signature":"sig"},
  {"id":"e8100000-0000-4000-8000-000000000011","storeId":"a2000000-0000-4000-8000-000000000001","employeeId":"a8000000-0000-4000-8000-000000000001","eventType":"IN","deviceSeq":911,"occurredAt":"2026-10-09T14:40:00Z","tzOffsetMin":-360,"monotonicMs":11,"bootId":"h","clockFlags":[],"decisionFlags":[],"capturedOffline":true,"policyVersion":1,"appVersion":"0.7.0","signature":"sig"},
  {"id":"e8100000-0000-4000-8000-000000000012","storeId":"a2000000-0000-4000-8000-000000000001","employeeId":"a8000000-0000-4000-8000-000000000001","eventType":"OUT","deviceSeq":912,"occurredAt":"2026-10-09T23:00:00Z","tzOffsetMin":-360,"monotonicMs":12,"bootId":"h","clockFlags":[],"decisionFlags":["out_end"],"capturedOffline":true,"policyVersion":1,"appVersion":"0.7.0","signature":"sig"}
]$$::jsonb) is not null;
reset role;
select private.recompute_day_flags(:EMP, '2026-10-01', '2026-10-31');
select test.ok((select count(*) from public.attendance_day_flags where employee_id = :EMP) = 0, 'sin horario asignado: no se clasifica ninguna tardanza ni ausencia');

-- Horario de la sucursal A1: lunes a domingo 08:00 (Guatemala), tolerancia 5 min; permiso el 10 de octubre.
select test.as_user(:CA);
insert into public.work_schedules (id, organization_id, name, tolerance_minutes) values ('a9000000-0000-4000-8000-000000000001', :ORGA, 'Turno mañana', 5);
insert into public.work_schedule_days (organization_id, schedule_id, weekday, start_time, end_time)
select :ORGA, 'a9000000-0000-4000-8000-000000000001', d, '08:00', '17:00' from generate_series(1, 7) d;
insert into public.schedule_assignments (organization_id, schedule_id, store_id, valid_from) values (:ORGA, 'a9000000-0000-4000-8000-000000000001', :A1, '2026-10-01');
insert into public.schedule_exceptions (organization_id, employee_id, on_date, kind, reason) values (:ORGA, :EMP, '2026-10-10', 'permit', 'Cita médica autorizada');
select test.reset();
select test.as_user(:CB);
select test.ok(test.raises($$insert into public.work_schedules (organization_id, name) values ('a0000000-0000-4000-8000-000000000000', 'Intruso')$$), 'otra organización no puede crear horarios en A');
select test.reset();

-- Primero solo 2 días con tardanza (5 y 6 de octubre).
select private.recompute_day_flags(:EMP, '2026-10-01', '2026-10-06');
select test.ok((select count(*) from public.attendance_day_flags where employee_id = :EMP and kind = 'late') = 2
  and (select minutes_late from public.attendance_day_flags where employee_id = :EMP and work_date = '2026-10-05') = 20
  and (select minutes_late from public.attendance_day_flags where employee_id = :EMP and work_date = '2026-10-06') = 10,
  'tardanzas calculadas contra 08:00 (minutos reales de retraso; varias entradas el mismo día = una sola tardanza)');
select test.ok(not exists (select 1 from public.alerts where employee_id = :EMP), 'con 2 tardanzas no hay alerta');
select test.ok((select count(*) from public.attendance_day_flags where employee_id = :EMP and kind = 'no_show' and work_date between '2026-10-01' and '2026-10-04') = 4,
  'días con horario y sin ninguna marcación (1–4 oct): posible ausencia, sin verificar');
-- Mes completo: 3 min (dentro de tolerancia) no es tardanza; 8 y 9 de octubre sí → 4 tardanzas.
select private.recompute_day_flags(:EMP, '2026-10-01', '2026-10-31');
select test.ok((select count(*) from public.attendance_day_flags where employee_id = :EMP and kind = 'late') = 4, 'tolerancia aplicada: 4 tardanzas en octubre');
select test.ok(not exists (select 1 from public.attendance_day_flags where employee_id = :EMP and work_date = '2026-10-10'), 'día con permiso autorizado: ni tardanza ni ausencia');
select test.ok(exists (select 1 from public.attendance_day_flags where employee_id = :EMP and work_date = '2026-10-11' and kind = 'no_show'), 'día con horario y sin marcación: posible ausencia (sin verificar)');
select test.ok((select count(*) from public.alerts where employee_id = :EMP and period_key = '2026-10') = 1
  and (select count from public.alerts where employee_id = :EMP and period_key = '2026-10') = 4, 'una sola alerta del mes con 4 tardanzas');
-- Recalcular otra vez (p. ej. una nueva sincronización) no duplica la alerta.
select private.recompute_day_flags(:EMP, '2026-10-01', '2026-10-31');
select test.ok((select count(*) from public.alerts where employee_id = :EMP) = 1 and (select count(*) from public.alert_events e join public.alerts a on a.id = e.alert_id where a.employee_id = :EMP and e.kind = 'created') = 1,
  'sin alertas duplicadas al resincronizar');
-- Corrección auditada: anular la entrada del 9 de octubre → 3 tardanzas; la alerta se actualiza (no se borra).
select test.as_user(:CA);
select public.correct_attendance('void', :EMP, 'Marcación duplicada por error del teléfono', 'e8100000-0000-4000-8000-000000000011') is not null;
select test.reset();
select private.recompute_day_flags(:EMP, '2026-10-01', '2026-10-31');
select test.ok((select count from public.alerts where employee_id = :EMP and period_key = '2026-10') = 3
  and exists (select 1 from public.alert_events e join public.alerts a on a.id = e.alert_id where a.employee_id = :EMP and e.kind = 'count_changed' and e.from_value = '4' and e.to_value = '3'),
  'la corrección recalcula: la alerta pasa de 4 a 3 con historial del cambio');

-- 4. Seguimiento de la alerta y permisos por sucursal.
select test.as_user(:SV);
select test.ok((select count(*) from public.alerts where employee_id = :EMP) = 1, 'la supervisora de A1 ve la alerta de su sucursal');
select test.ok(test.raises($$select public.alert_followup((select id from public.alerts limit 1), 'dismissed', 'corto')$$), 'descartar exige justificación');
select public.alert_followup((select id from public.alerts where employee_id = 'a8000000-0000-4000-8000-000000000001'), 'reviewed', 'Revisado con el empleado');
select test.reset();
select test.ok((select status from public.alerts where employee_id = :EMP) = 'reviewed', 'alerta marcada como revisada');
select test.as_user(:CB);
select test.ok((select count(*) from public.alerts) = 0 and (select count(*) from public.attendance_day_flags) = 0, 'otra organización no ve alertas ni tardanzas de A');
select test.reset();

-- 5. Medidas disciplinarias: registro, seguimiento, anulación justificada; sin borrado.
select test.as_user(:SV);
create temp table disc as select public.create_disciplinary_record(:EMP, 'disciplinary', '2026-10-09', (select id from public.hr_catalog where organization_id = 'a0000000-0000-4000-8000-000000000000' and label = 'Problemas de puntualidad'),
  'written', 'Llegó tarde cuatro veces durante octubre de 2026.', 'Se conversó con el empleado', false) id;
select test.reset();
grant select on disc to authenticated;
select test.as_user(:SV);
select test.ok(test.raises($$select public.create_disciplinary_record('a8000000-0000-4000-8000-000000000002', 'disciplinary', '2026-10-09', null, 'verbal', 'Incidente fuera de su sucursal autorizada', null, false)$$),
  'la supervisora no registra medidas para empleados de otra sucursal');
select public.followup_disciplinary_record((select id from disc), 'communicated', 'Se entregó la llamada de atención por escrito');
select test.ok(test.raises($$select public.void_disciplinary_record((select id from disc), 'no corresponde anular')$$), 'la supervisora no puede anular');
select test.reset();
select test.as_user(:CA);
select test.ok(test.raises($$delete from public.disciplinary_records$$) or (select count(*) from public.disciplinary_records) = 1, 'no se puede borrar un registro disciplinario');
select public.void_disciplinary_record((select id from disc), 'Registrado al empleado equivocado');
select test.ok((select status from public.disciplinary_records where id = (select id from disc)) = 'voided'
  and (select count(*) from public.disciplinary_followups where record_id = (select id from disc)) = 2, 'anulado con historial de seguimiento completo');
select test.reset();
select test.ok(exists (select 1 from public.audit_log where entity = 'disciplinary_records' and action = 'update'), 'cambios disciplinarios auditados');
-- El superadministrador con soporte concedido NO ve expedientes ni disciplina.
select test.as_user(:CA);
select public.grant_support_access(:ORGA, 2, 'Revisión técnica');
select test.reset();
select test.as_user(:SUPER);
select test.ok((select count(*) from public.employees where organization_id = :ORGA) > 0 and (select count(*) from public.disciplinary_records) = 0
  and (select count(*) from public.employment_periods) = 0, 'soporte: ve empleados y asistencia, pero no expedientes ni disciplina');
select test.reset();
select test.as_user(:CA);
select public.revoke_support_access(:ORGA);

-- 6. Baja con motivo: conserva historial y deja de estar autorizado; recontratación con período nuevo.
select test.ok(test.raises($$select public.terminate_employee('a8000000-0000-4000-8000-000000000001', 'dismissal', current_date, 'x', null, null)$$), 'la baja exige motivo específico');
select public.terminate_employee(:EMP, 'dismissal', current_date, 'Incumplimientos reiterados de procedimientos internos', 'Carta entregada', 'Sin observaciones');
select test.reset();
select test.ok((select status from public.employees where id = :EMP) = 'terminated'
  and (select end_type || '|' || end_reason from public.employment_periods where employee_id = :EMP and period_no = 1) = 'dismissal|Incumplimientos reiterados de procedimientos internos',
  'baja registrada con tipo y motivo');
select test.ok((select count(*) from public.attendance_events where employee_id = :EMP) = 12 and (select count(*) from public.disciplinary_records where employee_id = :EMP) = 1
  and (select count(*) from public.attendance_day_flags where employee_id = :EMP) > 0, 'el historial (asistencia, disciplina, tardanzas) se conserva');
set role service_role;
select test.ok(not exists (select 1 from private.device_roster('d0000000-0000-4000-8000-000000000001', 168) where employee_id = 'a8000000-0000-4000-8000-000000000001'),
  'tras la baja el teléfono ya no lo autoriza (se elimina en la siguiente sincronización)');
reset role;
select test.as_user(:CA);
select test.ok(test.raises($$select public.rehire_employee('a8000000-0000-4000-8000-000000000001', '2000-01-01', null, null)$$), 'el reingreso no puede ser anterior a la salida');
select public.rehire_employee(:EMP, current_date + 1, :A1, 'Regresa a la sucursal A1');
select test.reset();
select test.ok((select count(*) from public.employment_periods where employee_id = :EMP) = 2
  and (select started_on from public.employment_periods where employee_id = :EMP and period_no = 2) = current_date + 1
  and (select ended_on from public.employment_periods where employee_id = :EMP and period_no = 1) = current_date
  and (select status from public.employees where id = :EMP) = 'active', 'recontratación: nuevo período sin mezclar fechas, misma identidad');
select test.ok((select count(*) from public.employees where first_name = 'Juan' and last_name = 'Pérez') = 1, 'sin duplicar al empleado');

-- 7. Baja con fecha futura: sigue activo hasta ese día.
select test.as_user(:CA);
select public.terminate_employee(:EMP2, 'contract_end', current_date + 10, 'Fin del contrato por temporada', null, null);
select test.reset();
select test.ok((select status from public.employees where id = :EMP2) = 'active' and private.apply_scheduled_terminations() = 0, 'baja programada: activo hasta la fecha efectiva');
\echo 'Pruebas de ciclo laboral, expediente, puntualidad y alertas superadas'
