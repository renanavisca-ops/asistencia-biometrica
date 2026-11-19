-- Motivos de baja protegidos, permisos adicionales, plataforma (planes, indicadores, soporte auditado) y horarios
-- semanales importados por sucursal. Continúa el escenario de 80_ (Juan fue despedido con motivo y recontratado).
\set QUIET on
\pset tuples_only on
\pset format unaligned
\set SUPER '\'00000000-0000-4000-8000-00000000000a\''
\set CA '\'00000000-0000-4000-8000-00000000000b\''
\set SV '\'00000000-0000-4000-8000-00000000000c\''
\set CB '\'00000000-0000-4000-8000-00000000000d\''
\set AUD '\'00000000-0000-4000-8000-00000000000e\''
\set ORGA '\'a0000000-0000-4000-8000-000000000000\''
\set A2 '\'a2000000-0000-4000-8000-000000000002\''
\set EMP '\'a8000000-0000-4000-8000-000000000001\''
\set EMP2 '\'a8000000-0000-4000-8000-000000000002\''

-- 1. Motivos de baja: la supervisora de la sucursal ve el tipo y las fechas, nunca el motivo.
select test.as_user(:SV);
select test.ok((select end_type from public.employment_periods where employee_id = :EMP and period_no = 1) = 'dismissal', 'supervisora: ve el tipo de salida');
select test.ok(test.raises($$select end_reason from public.employment_periods$$), 'supervisora: la columna del motivo está bloqueada');
select test.ok(test.raises($$select end_comments, end_notes from public.employment_periods$$), 'supervisora: comentarios y observaciones bloqueados');
select test.ok((select count(*) from public.termination_details(:EMP)) = 0, 'supervisora: termination_details no devuelve nada');
select test.ok(not exists (select 1 from public.employment_events where employee_id = :EMP and details ? 'reason'), 'los eventos laborales no contienen el motivo');
select test.ok(test.raises($$select reason from public.employee_status_history$$), 'el historial de estado no expone motivos');
select test.ok(not exists (select 1 from public.audit_log where entity = 'employment_periods'), 'supervisora: sin acceso a la auditoría de períodos');
select test.reset();
-- El auditor (solo lectura de toda la organización) tampoco ve motivos, ni por la auditoría.
select test.as_user(:AUD);
select test.ok((select count(*) from public.termination_details(:EMP)) = 0
  and not exists (select 1 from public.audit_log where entity = 'employment_periods'), 'auditor: sin motivos (ni en la auditoría)');
select test.ok(exists (select 1 from public.audit_log where entity = 'employees'), 'auditor: el resto de la auditoría sigue visible');
select test.reset();
-- La administración central sí.
select test.as_user(:CA);
select test.ok((select reason from public.termination_details(:EMP) limit 1) = 'Incumplimientos reiterados de procedimientos internos'
  and (select comments from public.termination_details(:EMP) limit 1) = 'Carta entregada', 'administración central: ve motivo y comentarios');
select test.ok(exists (select 1 from public.audit_log where entity = 'employment_periods'), 'administración central: auditoría completa');

-- 2. Permiso expreso a una persona: la supervisora pasa a ver los motivos SOLO de los empleados de su sucursal.
select test.reset();
select test.as_user(:SV);
select test.ok(test.raises($$select public.grant_extra_permission('00000000-0000-4000-8000-00000000000c', 'a0000000-0000-4000-8000-000000000000', 'hr.sensitive')$$),
  'la supervisora no puede darse el permiso');
select test.reset();
select test.as_user(:CA);
select public.grant_extra_permission(:SV, :ORGA, 'hr.sensitive');
select test.ok(test.raises($$select public.grant_extra_permission('00000000-0000-4000-8000-00000000000d', 'a0000000-0000-4000-8000-000000000000', 'hr.sensitive')$$),
  'no se concede a alguien sin rol en la organización');
select test.reset();
select test.as_user(:SV);
select test.ok((select count(*) from public.termination_details(:EMP)) = 1, 'con permiso: la supervisora ve el motivo de su sucursal');
select test.ok((select count(*) from public.termination_details(:EMP2)) = 0, 'pero no el de empleados de otra sucursal');
select test.reset();
select test.as_user(:CA);
select public.revoke_extra_permission((select id from public.admin_permission_grants where user_id = :SV and revoked_at is null));
select test.reset();
select test.as_user(:SV);
select test.ok((select count(*) from public.termination_details(:EMP)) = 0, 'permiso revocado: deja de verlos');
select test.reset();
select test.ok((select count(*) from public.audit_log where entity = 'admin_permission_grants') = 2, 'concesión y revocación auditadas');

-- 3. Plataforma: el propietario no ve motivos ni con soporte; cada ingreso de soporte queda auditado en la organización.
select test.as_user(:SUPER);
select public.record_support_view(:ORGA, '/employees');
select test.reset();
select test.ok(not exists (select 1 from public.audit_log where action = 'support_view'), 'sin acceso de soporte vigente no hay ingreso');
select test.as_user(:CA);
select public.grant_support_access(:ORGA, 1, 'Revisión de horarios');
select test.reset();
select test.as_user(:SUPER);
select public.record_support_view(:ORGA, '/employees');
select public.record_support_view(:ORGA, '/attendance');
select test.ok((select count(*) from public.termination_details(:EMP)) = 0, 'soporte: sin motivos de baja');
select test.reset();
select test.ok((select count(*) from public.audit_log where action = 'support_view' and organization_id = :ORGA and actor = :SUPER) = 1,
  'ingreso de soporte registrado en la auditoría de la organización (sin duplicar)');
select test.as_user(:CA);
select test.ok(exists (select 1 from public.audit_log where action = 'support_view'), 'la organización ve quién entró por soporte');
select public.revoke_support_access(:ORGA);
select test.ok(test.raises($$select * from public.platform_growth(12)$$), 'una organización no ve indicadores globales');
select test.ok(test.raises($$select public.platform_save_plan(null, 'x1', 'X', 1, null, null, '{}', null, true, 1)$$), 'ni crea planes');
select test.reset();
select test.as_user(:SUPER);
select test.ok((select count(*) from public.platform_growth(12)) = 12 and (select max(total_orgs) from public.platform_growth(12)) >= 2, 'indicadores de crecimiento por mes');
create temp table plan90 as select public.platform_save_plan(null, 'pro25', 'Profesional 25', 25, 3, 4, '{"reports": false}', 'Precio a convenir', true, 35) id;
select public.platform_apply_plan((select id from public.platform_orgs() where name = 'Cliente Manual'), (select id from plan90), now() + interval '60 days');
select test.ok((select max_employees || '/' || max_stores || '/' || max_devices || '/' || (features ->> 'reports') from public.platform_orgs() where id = (select id from public.platform_orgs() where name = 'Cliente Manual')) = '25/3/4/false',
  'aplicar un plan copia límites y módulos a la organización');
select test.reset();
select test.ok(exists (select 1 from public.audit_log where action = 'platform_apply_plan' and organization_id is null), 'cambio de plan auditado en la plataforma');

-- 4. Horario semanal importado (sucursal A2, semana del lunes 12 de octubre de 2026).
select employee_code as code2 from public.employees where id = :EMP2 \gset
select test.as_user(:CA);
select test.ok(test.raises($$select public.import_weekly_schedule('a2000000-0000-4000-8000-000000000002', '2026-10-13', 5, '[{"code":"X","days":{}}]')$$), 'la semana debe iniciar en lunes');
select test.ok(test.raises($$select public.import_weekly_schedule('a2000000-0000-4000-8000-000000000002', '2026-10-12', 5, '[{"code":"NO-EXISTE","days":{}}]')$$), 'códigos desconocidos: se rechaza todo el archivo');
select test.ok((public.import_weekly_schedule(:A2, '2026-10-12', 5, format('[{"code":%s,"days":{"1":{"start":"08:00","end":"16:00"},"2":{"start":"09:00","end":"17:00"}}}]', to_json(:'code2'::text))::jsonb) ->> 'employees')::int = 1,
  'importación de la semana');
select test.ok((select start_time from public.store_week_schedule(:A2, '2026-10-12') where employee_id = :EMP2 and weekday = 1) = '08:00'
  and (select end_time from public.store_week_schedule(:A2, '2026-10-12') where employee_id = :EMP2 and weekday = 2) = '17:00'
  and (select kind from public.store_week_schedule(:A2, '2026-10-12') where employee_id = :EMP2 and weekday = 3) = 'none', 'vista semanal de la sucursal');
select test.reset();
select test.ok((select count(*) from public.attendance_day_flags where employee_id = :EMP2 and work_date between '2026-10-12' and '2026-10-18') = 2,
  'semana pasada: se recalculan los días con horario (lunes y martes sin marcación)');
select test.as_user(:CA);
select public.import_weekly_schedule(:A2, '2026-10-12', 5, format('[{"code":%s,"days":{"1":{"start":"08:00","end":"16:00"}}}]', to_json(:'code2'::text))::jsonb);
select test.reset();
select test.ok((select count(*) from public.schedule_assignments where note like 'semana:%') = 1
  and (select count(*) from public.work_schedules where source = 'weekly_import') = 1, 'reimportar la misma semana reemplaza (sin acumular)');
select test.ok((select count(*) from public.attendance_day_flags where employee_id = :EMP2 and work_date between '2026-10-12' and '2026-10-18') = 1, 'y recalcula');
select test.ok(not exists (select 1 from public.attendance_day_flags where employee_id = :EMP2 and work_date = '2026-10-19'), 'fuera de la semana no aplica');
select test.as_user(:SV);
select test.ok(test.raises(format($$select public.import_weekly_schedule('a2000000-0000-4000-8000-000000000002', '2026-10-19', 5, '[{"code":%s,"days":{}}]')$$, to_json(:'code2'::text))),
  'la supervisora no importa horarios');
select test.reset();
select test.as_user(:CB);
select test.ok(test.raises($$select * from public.store_week_schedule('a2000000-0000-4000-8000-000000000002', '2026-10-12')$$), 'otra organización no ve los horarios');
select test.reset();
\echo 'Pruebas de contextos, datos sensibles y horarios semanales superadas'
