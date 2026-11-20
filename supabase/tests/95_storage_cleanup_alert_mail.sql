-- Limpieza de archivos (cola con verificación previa) y correos de alertas (destinatarios, sin duplicados, registro).
\set QUIET on
\pset tuples_only on
\pset format unaligned
\set CA '\'00000000-0000-4000-8000-00000000000b\''
\set SV '\'00000000-0000-4000-8000-00000000000c\''
\set CB '\'00000000-0000-4000-8000-00000000000d\''
\set ORGA '\'a0000000-0000-4000-8000-000000000000\''
\set ORGB '\'b0000000-0000-4000-8000-000000000000\''
\set EMP2 '\'a8000000-0000-4000-8000-000000000002\''

-- ---------- Archivos ----------
-- Org A (activa): un documento registrado, un huérfano antiguo (falló el registro hace 2 días) y una subida en curso (10 min).
insert into public.hr_documents (organization_id, employee_id, doc_type, file_name, storage_path, uploaded_by)
values (:ORGA, :EMP2, 'Contrato', 'contrato.pdf', 'a0000000-0000-4000-8000-000000000000/a8000000-0000-4000-8000-000000000002/doc-ok.pdf', :CA);
insert into storage.objects (bucket_id, name, created_at) values
  ('hr-documents', 'a0000000-0000-4000-8000-000000000000/a8000000-0000-4000-8000-000000000002/doc-ok.pdf', now() - interval '3 days'),
  ('hr-documents', 'a0000000-0000-4000-8000-000000000000/a8000000-0000-4000-8000-000000000002/huerfano.pdf', now() - interval '2 days'),
  ('hr-documents', 'a0000000-0000-4000-8000-000000000000/a8000000-0000-4000-8000-000000000002/subiendo.pdf', now() - interval '10 minutes');
select test.ok(private.enqueue_storage_orphans() = 1, 'huérfanos: solo el archivo sin registro con más de 24 h');
select test.ok(private.enqueue_storage_orphans() = 0, 'encolar es idempotente');
select test.ok(not exists (select 1 from private.storage_deletions where path like '%doc-ok.pdf' or path like '%subiendo.pdf'),
  'un documento registrado o una subida reciente nunca se encolan');
create temp table claim1 as select * from private.storage_cleanup_claim(100);
select test.ok((select count(*) from claim1) = 1 and (select path from claim1) like '%huerfano.pdf', 'el trabajador reclama el huérfano');
select private.storage_cleanup_result(array(select id from claim1), true, null);
select test.ok((select deleted_at is not null from private.storage_deletions where path like '%huerfano.pdf'), 'borrado registrado');
-- Si un archivo encolado vuelve a estar referenciado (p. ej. el registro se completó), se descarta en vez de borrarse.
insert into private.storage_deletions (bucket, path, organization_id, reason)
values ('hr-documents', 'a0000000-0000-4000-8000-000000000000/a8000000-0000-4000-8000-000000000002/doc-ok.pdf', :ORGA, 'orphan');
select test.ok(not exists (select 1 from private.storage_cleanup_claim(100) where path like '%doc-ok.pdf'), 'el documento en uso no se reclama');
select test.ok((select gave_up_at is not null and last_error like 'descartado%' from private.storage_deletions where path like '%doc-ok.pdf'),
  'verificación previa: un documento en uso no se borra');
-- Reintentos: un error deja el elemento pendiente con el error registrado; a los 10 intentos se abandona.
insert into storage.objects (bucket_id, name, created_at) values ('hr-documents', 'a0000000-0000-4000-8000-000000000000/x/fallo.pdf', now() - interval '3 days');
select private.enqueue_storage_orphans();
create temp table claim2 as select * from private.storage_cleanup_claim(100);
select private.storage_cleanup_result(array(select id from claim2), false, 'timeout de red');
select test.ok((select deleted_at is null and gave_up_at is null and attempts = 1 and last_error = 'timeout de red' from private.storage_deletions where path like '%fallo.pdf'),
  'error registrado; sigue pendiente para reintento');
select test.ok(not exists (select 1 from private.storage_cleanup_claim(100) where path like '%fallo.pdf'), 'espera antes de reintentar (no reintenta de inmediato)');
update private.storage_deletions set attempts = 10, last_attempt_at = now() - interval '1 day' where path like '%fallo.pdf';
select private.storage_cleanup_result(array(select id from private.storage_deletions where path like '%fallo.pdf'), false, 'sigue fallando');
select test.ok((select gave_up_at is not null from private.storage_deletions where path like '%fallo.pdf'), 'tras 10 intentos queda marcado para revisión manual');

-- Borrado definitivo de una organización: se encolan sus archivos (registrados y sueltos), y solo los suyos.
insert into public.organizations (id, name) values ('c0000000-0000-4000-8000-000000000000', 'Org C');
insert into public.employees (id, organization_id, first_name, last_name) values ('c3000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000000', 'Carla', 'Ruiz');
insert into public.hr_documents (organization_id, employee_id, doc_type, file_name, storage_path, uploaded_by)
values ('c0000000-0000-4000-8000-000000000000', 'c3000000-0000-4000-8000-000000000001', 'Carta', 'carta.pdf',
        'c0000000-0000-4000-8000-000000000000/c3000000-0000-4000-8000-000000000001/carta.pdf', :CA);
insert into storage.objects (bucket_id, name) values
  ('hr-documents', 'c0000000-0000-4000-8000-000000000000/c3000000-0000-4000-8000-000000000001/carta.pdf'),
  ('hr-documents', 'c0000000-0000-4000-8000-000000000000/c3000000-0000-4000-8000-000000000001/suelto.pdf');
-- Mientras la organización existe, sus archivos no son borrables aunque alguien los encole.
select private.enqueue_org_files('c0000000-0000-4000-8000-000000000000');
select test.ok(not exists (select 1 from private.storage_cleanup_claim(100) where path like 'c0000000%'), 'organización activa: sus archivos no se borran');
delete from private.storage_deletions where path like 'c0000000%';
select private.purge_org('c0000000-0000-4000-8000-000000000000');
select test.ok((select count(*) from private.storage_deletions where organization_id = 'c0000000-0000-4000-8000-000000000000' and reason = 'org_purged' and deleted_at is null and gave_up_at is null) = 2,
  'borrado definitivo: se encolan sus 2 archivos (registrado y suelto)');
select test.ok((select count(*) from private.storage_cleanup_claim(100) where path like 'c0000000%') = 2, 'y el trabajador los reclama');
select test.ok(not exists (select 1 from private.storage_deletions where reason = 'org_purged' and path like 'a0000000%'), 'ningún archivo de otra organización');

-- ---------- Correos de alertas ----------
select test.as_user(:CA);
select test.ok(test.raises($$select public.set_alert_notifications('a0000000-0000-4000-8000-000000000000', true, '{}')$$), 'activar exige al menos un destinatario');
select test.ok(test.raises($$select public.set_alert_notifications('a0000000-0000-4000-8000-000000000000', true, array['00000000-0000-4000-8000-00000000000d'::uuid])$$),
  'no se puede enviar a alguien de otra organización');
select public.set_alert_notifications(:ORGA, true, array[:CA::uuid]);
select public.set_alert_rules(:ORGA, true, 3, null);
select test.ok((select notify_admin_ids = array[:CA::uuid] and email_enabled from public.alert_rules where organization_id = :ORGA), 'guardar la regla de tardanzas conserva los destinatarios');
select test.reset();
select test.as_user(:SV);
select test.ok(test.raises($$select public.set_alert_notifications('a0000000-0000-4000-8000-000000000000', false, '{}')$$), 'la supervisora no cambia los destinatarios');
select test.reset();
-- Nueva alerta (umbral alcanzado) → un correo pendiente por destinatario.
insert into public.alerts (organization_id, kind, employee_id, store_id, period_key, count, threshold)
values (:ORGA, 'tardiness', :EMP2, 'a2000000-0000-4000-8000-000000000002', '2026-12', 3, 3);
select test.ok((select count(*) from public.alert_notifications n join public.alerts a on a.id = n.alert_id where a.period_key = '2026-12') = 1
  and (select recipient_email from public.alert_notifications n join public.alerts a on a.id = n.alert_id where a.period_key = '2026-12') = 'ca@x',
  'alerta nueva: correo encolado para el destinatario configurado');
-- La 4.ª tardanza actualiza la alerta, no genera otro correo.
update public.alerts set count = 4 where period_key = '2026-12';
select test.ok((select count(*) from public.alert_notifications n join public.alerts a on a.id = n.alert_id where a.period_key = '2026-12') = 1, 'sin correos duplicados al actualizarse la alerta');
create temp table mail1 as select * from private.mail_claim(50);
select test.ok((select count(*) from mail1) = 1 and (select employee_name || '|' || store_name || '|' || count || '|' || period_key from mail1) = 'Rosa Díaz|Tienda A2|4|2026-12',
  'el trabajador recibe solo lo necesario: empleado, tienda, conteo y mes');
select private.mail_result((select id from mail1), true, null, 'msg_123');
select test.ok((select status || '|' || provider_message_id from public.alert_notifications where id = (select id from mail1)) = 'sent|msg_123', 'envío registrado');
select test.ok(not exists (select 1 from private.mail_claim(50)), 'un correo enviado no se vuelve a enviar');
-- Fallo del proveedor: queda pendiente con el error; tras 5 intentos, fallido. La alerta sigue en el panel.
insert into public.alerts (organization_id, kind, employee_id, period_key, count, threshold) values (:ORGA, 'tardiness', :EMP2, '2027-01', 3, 3);
create temp table mail2 as select * from private.mail_claim(50);
select private.mail_result((select id from mail2), false, 'Resend 500', null);
select test.ok((select status || '|' || attempts || '|' || last_error from public.alert_notifications where id = (select id from mail2)) = 'pending|1|Resend 500', 'error registrado, pendiente de reintento');
update public.alert_notifications set attempts = 5 where id = (select id from mail2);
select private.mail_result((select id from mail2), false, 'Resend 500', null);
select test.ok((select status from public.alert_notifications where id = (select id from mail2)) = 'failed'
  and exists (select 1 from public.alerts where period_key = '2027-01' and status = 'pending'), 'tras 5 intentos queda «fallido»; la alerta sigue pendiente en el panel');
-- Desactivar: lo pendiente se omite y no se encolan nuevos.
insert into public.alerts (organization_id, kind, employee_id, period_key, count, threshold) values (:ORGA, 'tardiness', :EMP2, '2027-02', 3, 3);
select test.as_user(:CA);
select public.set_alert_notifications(:ORGA, false, array[:CA::uuid]);
select test.reset();
select test.ok(not exists (select 1 from private.mail_claim(50)), 'nada que enviar');
select test.ok((select n.status from public.alert_notifications n join public.alerts a on a.id = n.alert_id where a.period_key = '2027-02') = 'skipped',
  'notificaciones desactivadas: lo pendiente se omite');
insert into public.alerts (organization_id, kind, employee_id, period_key, count, threshold) values (:ORGA, 'tardiness', :EMP2, '2027-03', 3, 3);
select test.ok(not exists (select 1 from public.alert_notifications n join public.alerts a on a.id = n.alert_id where a.period_key = '2027-03'), 'y no se encolan nuevos');
-- Aislamiento: otra organización no ve el registro de envíos.
select test.as_user(:CB);
select test.ok((select count(*) from public.alert_notifications) = 0, 'otra organización no ve los envíos de A');
select test.reset();
select test.as_user(:CA);
select test.ok((select count(*) from public.alert_notifications) = 3, 'la administración ve su registro de envíos');
select test.reset();
\echo 'Pruebas de limpieza de archivos y correos de alertas superadas'

-- Umbrales seguros: ninguna organización queda con una política vigente por debajo de 0,62 / 0,12.
select test.ok(not exists (select 1 from public.device_policy_versions p
  where p.version = (select max(version) from public.device_policy_versions x where x.organization_id = p.organization_id)
    and p.policy ? 'matchThreshold' and ((p.policy ->> 'matchThreshold')::numeric < 0.62 or (p.policy ->> 'matchMargin')::numeric < 0.12)),
  'políticas vigentes con umbral ≥ 0,62 y margen ≥ 0,12');
