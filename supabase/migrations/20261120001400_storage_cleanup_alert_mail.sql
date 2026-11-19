-- =====================================================================================
-- 2026-11-20
--  1. Limpieza de archivos de Storage (bucket hr-documents) con la API oficial, mediante una cola:
--       a) al borrar definitivamente una organización (90 días tras su eliminación) se encolan todos sus archivos;
--       b) archivos huérfanos (subidos pero sin registro, p. ej. si falló el registro) con más de 24 h se encolan.
--     Antes de borrar, el trabajador vuelve a comprobar que el archivo sigue siendo borrable (la organización ya no
--     existe, o ningún documento lo referencia). Reintentos con registro de errores; auditoría por ejecución.
--  2. Correos de alertas: destinatarios por organización (administradores con acceso a alertas), activables y
--     desactivables; una notificación por alerta y destinatario (sin duplicados), con registro de intentos y errores.
--     La alerta siempre queda en el panel aunque el correo falle.
--  3. Trabajador: Edge Function «background-jobs», invocada cada 10 minutos por pg_cron + pg_net con un secreto
--     aleatorio guardado en Vault (sin claves manejadas por personas).
-- =====================================================================================

-- ---------- 1. Cola de borrado de archivos ----------
create table if not exists private.storage_deletions (
  id bigint generated always as identity primary key,
  bucket text not null,
  path text not null,
  organization_id uuid,
  reason text not null check (reason in ('org_purged', 'orphan')),
  queued_at timestamptz not null default now(),
  attempts int not null default 0,
  last_attempt_at timestamptz,
  last_error text,
  deleted_at timestamptz,
  gave_up_at timestamptz
);
create unique index if not exists storage_deletions_pending on private.storage_deletions (bucket, path) where deleted_at is null and gave_up_at is null;

-- Archivos de una organización: los registrados y cualquier objeto bajo su carpeta (incluidos huérfanos).
create or replace function private.enqueue_org_files(p_org uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare n int := 0; k int;
begin
  insert into private.storage_deletions (bucket, path, organization_id, reason)
  select 'hr-documents', d.storage_path, p_org, 'org_purged' from public.hr_documents d where d.organization_id = p_org
  on conflict do nothing;
  get diagnostics n = row_count;
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute $q$insert into private.storage_deletions (bucket, path, organization_id, reason)
      select 'hr-documents', o.name, $1, 'org_purged' from storage.objects o where o.bucket_id = 'hr-documents' and o.name like $1::text || '/%'
      on conflict do nothing$q$ using p_org;
    get diagnostics k = row_count; n := n + k;
  end if;
  return n;
end $$;

-- purge_org (borrado definitivo) llama a purge_org_extra antes de borrar los documentos: encola sus archivos.
create or replace function private.purge_org_extra(p_org uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.enqueue_org_files(p_org);
  delete from public.admin_permission_grants where organization_id = p_org;
  delete from public.alert_notifications where organization_id = p_org;
end $$;

-- Huérfanos: objetos del bucket sin documento que los referencie, con más de p_grace de antigüedad.
create or replace function private.enqueue_storage_orphans(p_grace interval default interval '24 hours') returns int
language plpgsql security definer set search_path = '' as $$
declare n int := 0;
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then return 0; end if;
  execute $q$insert into private.storage_deletions (bucket, path, organization_id, reason)
    select o.bucket_id, o.name, nullif(split_part(o.name, '/', 1), '')::uuid, 'orphan' from storage.objects o
     where o.bucket_id = 'hr-documents' and o.created_at < now() - $1
       and split_part(o.name, '/', 1) ~ '^[0-9a-f-]{36}$'
       and not exists (select 1 from public.hr_documents d where d.storage_path = o.name)
    on conflict do nothing$q$ using p_grace;
  get diagnostics n = row_count;
  return n;
end $$;

-- Reclama un lote verificando de nuevo que cada archivo sea borrable. Lo que ya no lo es se descarta (no se borra).
create or replace function private.storage_cleanup_claim(p_limit int default 100)
returns table (id bigint, bucket text, path text) language plpgsql security definer set search_path = '' as $$
begin
  update private.storage_deletions q set gave_up_at = now(), last_error = 'descartado: el archivo volvió a estar en uso'
   where q.deleted_at is null and q.gave_up_at is null
     and ((q.reason = 'org_purged' and exists (select 1 from public.organizations o where o.id = q.organization_id))
       or exists (select 1 from public.hr_documents d where d.storage_path = q.path));
  return query
  update private.storage_deletions q set attempts = q.attempts + 1, last_attempt_at = now()
   where q.id in (select x.id from private.storage_deletions x where x.deleted_at is null and x.gave_up_at is null and x.attempts < 10
                    and (x.last_attempt_at is null or x.last_attempt_at < now() - make_interval(mins => least(5 * x.attempts, 120)))
                  order by x.id limit p_limit for update skip locked)
  returning q.id, q.bucket, q.path;
end $$;

create or replace function private.storage_cleanup_result(p_ids bigint[], p_ok boolean, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_ok then
    update private.storage_deletions set deleted_at = now(), last_error = null where id = any(p_ids);
  else
    update private.storage_deletions set last_error = left(p_error, 500), gave_up_at = case when attempts >= 10 then now() end where id = any(p_ids);
  end if;
end $$;

-- ---------- 2. Correos de alertas ----------
alter table public.alert_rules add column if not exists email_enabled boolean not null default false;

create table if not exists public.alert_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  alert_id uuid not null references public.alerts(id),
  recipient_user_id uuid not null,
  recipient_email text not null,
  kind text not null default 'created' check (kind in ('created')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts int not null default 0,
  last_attempt_at timestamptz,
  last_error text,
  provider_message_id text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (alert_id, recipient_user_id, kind)
);
create index if not exists alert_notifications_pending on public.alert_notifications (status, created_at) where status = 'pending';
alter table public.alert_notifications enable row level security;
create policy alert_notifications_select on public.alert_notifications for select to authenticated
  using (private.has_org_perm('alert.manage', organization_id));

-- Destinatarios válidos: administradores con rol vigente en la organización y permiso de ver alertas.
create or replace function private.valid_alert_recipient(p_user uuid, p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admin_role_grants g join public.role_permissions rp on rp.role = g.role and rp.permission = 'alert.read'
                 join public.admins a on a.user_id = g.user_id
                 where g.user_id = p_user and g.organization_id = p_org and g.role <> 'superadmin' and g.revoked_at is null and a.status = 'active');
$$;

create or replace function public.set_alert_notifications(p_org uuid, p_enabled boolean, p_recipients uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid;
begin
  if not private.has_org_perm('alert.manage', p_org) then raise exception 'permiso denegado' using errcode = '42501'; end if;
  foreach u in array coalesce(p_recipients, '{}') loop
    if not private.valid_alert_recipient(u, p_org) then raise exception 'Destinatario no válido: debe ser un administrador de la organización con acceso a alertas'; end if;
  end loop;
  if coalesce(p_enabled, false) and coalesce(array_length(p_recipients, 1), 0) = 0 then raise exception 'Elija al menos un destinatario'; end if;
  insert into public.alert_rules (organization_id, email_enabled, notify_admin_ids, updated_by, updated_at)
  values (p_org, coalesce(p_enabled, false), coalesce(p_recipients, '{}'), auth.uid(), now())
  on conflict (organization_id) do update set email_enabled = excluded.email_enabled, notify_admin_ids = excluded.notify_admin_ids,
    updated_by = excluded.updated_by, updated_at = now();
end $$;

-- La regla de tardanzas no toca los destinatarios si no se envían (p_notify null).
create or replace function public.set_alert_rules(p_org uuid, p_enabled boolean, p_threshold int, p_notify uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_org_perm('alert.manage', p_org) then raise exception 'permiso denegado' using errcode = '42501'; end if;
  insert into public.alert_rules (organization_id, tardiness_enabled, tardiness_threshold, notify_admin_ids, updated_by, updated_at)
  values (p_org, coalesce(p_enabled, true), coalesce(p_threshold, 3), coalesce(p_notify, '{}'), auth.uid(), now())
  on conflict (organization_id) do update set tardiness_enabled = excluded.tardiness_enabled, tardiness_threshold = excluded.tardiness_threshold,
    notify_admin_ids = coalesce(p_notify, public.alert_rules.notify_admin_ids), updated_by = excluded.updated_by, updated_at = now();
end $$;

-- Al crearse una alerta (umbral alcanzado en el mes) se encola un correo por destinatario. Sin duplicados (unique).
create or replace function private.enqueue_alert_mail() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r public.alert_rules%rowtype;
begin
  select * into r from public.alert_rules where organization_id = new.organization_id;
  if not found or not r.email_enabled or not private.feature_on(new.organization_id, 'alerts') then return new; end if;
  insert into public.alert_notifications (organization_id, alert_id, recipient_user_id, recipient_email)
  select new.organization_id, new.id, a.user_id, a.email from public.admins a
   where a.user_id = any(r.notify_admin_ids) and private.valid_alert_recipient(a.user_id, new.organization_id)
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists trg_alert_mail on public.alerts;
create trigger trg_alert_mail after insert on public.alerts for each row execute function private.enqueue_alert_mail();

-- Reclama correos pendientes; vuelve a comprobar que sigan activados y el destinatario siga autorizado.
-- Solo datos necesarios: nombre del empleado, tienda, conteo y mes (nada disciplinario).
create or replace function private.mail_claim(p_limit int default 50) returns table (
  id uuid, recipient_email text, org_name text, employee_name text, store_name text, period_key text, count int, threshold int, alert_id uuid, organization_id uuid)
language plpgsql security definer set search_path = '' as $$
begin
  update public.alert_notifications n set status = 'skipped', last_error = 'notificaciones desactivadas o destinatario sin acceso'
   where n.status = 'pending' and (not coalesce((select r.email_enabled from public.alert_rules r where r.organization_id = n.organization_id), false)
      or not private.valid_alert_recipient(n.recipient_user_id, n.organization_id)
      or not exists (select 1 from public.organizations o where o.id = n.organization_id and o.status = 'active'));
  return query
  with c as (
    update public.alert_notifications n set attempts = n.attempts + 1, last_attempt_at = now()
     where n.id in (select x.id from public.alert_notifications x where x.status = 'pending' and x.attempts < 5
                      and (x.last_attempt_at is null or x.last_attempt_at < now() - make_interval(mins => 10 * x.attempts))
                    order by x.created_at limit p_limit for update skip locked)
    returning n.*)
  select c.id, c.recipient_email, o.name, e.first_name || ' ' || e.last_name, s.name, a.period_key, a.count, a.threshold, a.id, c.organization_id
    from c join public.alerts a on a.id = c.alert_id join public.organizations o on o.id = c.organization_id
    join public.employees e on e.id = a.employee_id left join public.stores s on s.id = a.store_id;
end $$;

create or replace function private.mail_result(p_id uuid, p_ok boolean, p_error text, p_provider_id text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.alert_notifications set
    status = case when p_ok then 'sent' when attempts >= 5 then 'failed' else 'pending' end,
    sent_at = case when p_ok then now() end, provider_message_id = p_provider_id, last_error = case when p_ok then null else left(p_error, 500) end
   where id = p_id;
end $$;

-- ---------- 3. Trabajador programado ----------
create table if not exists private.app_config (key text primary key, value text not null, updated_at timestamptz not null default now());

create or replace function private.jobs_secret() returns text language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'vault') then return null; end if;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'jobs_secret'$q$ into v;
  return v;
end $$;

do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'vault') then
    if not exists (select 1 from vault.secrets where name = 'jobs_secret') then
      perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'jobs_secret', 'Secreto para invocar la Edge Function background-jobs');
    end if;
  end if;
end $$;

-- Llama a la Edge Function (si está configurada su URL en private.app_config 'functions_url').
create or replace function private.kick_background_jobs() returns void language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  select value into v_url from private.app_config where key = 'functions_url';
  v_secret := private.jobs_secret();
  if v_url is null or v_secret is null or not exists (select 1 from pg_extension where extname = 'pg_net') then return; end if;
  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 60000)'
    using v_url || '/background-jobs', jsonb_build_object('x-jobs-secret', v_secret, 'content-type', 'application/json'), '{}'::jsonb;
end $$;

-- Resumen de cada ejecución en la auditoría de plataforma (sin datos de organizaciones).
create or replace function private.jobs_audit(p_summary jsonb) returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log (organization_id, actor, actor_kind, action, entity, entity_id, after)
  select null, null, 'system', 'background_jobs', 'jobs', null, p_summary
   where coalesce((p_summary ->> 'storageDeleted')::int, 0) + coalesce((p_summary ->> 'storageFailed')::int, 0)
       + coalesce((p_summary ->> 'mailSent')::int, 0) + coalesce((p_summary ->> 'mailFailed')::int, 0) > 0;
$$;

do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then create extension if not exists pg_net; end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('background-jobs', '*/10 * * * *', 'select private.kick_background_jobs()');
    perform cron.schedule('storage-orphans', '40 4 * * *', 'select private.enqueue_storage_orphans()');
  end if;
end $$;

-- Permisos
revoke all on all functions in schema private from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant select on public.alert_notifications to authenticated';
    execute 'grant execute on function public.set_alert_notifications(uuid, boolean, uuid[]) to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.alert_notifications to service_role';
    execute 'grant execute on all functions in schema private to service_role';
  end if;
end $$;
revoke execute on function public.set_alert_notifications(uuid, boolean, uuid[]) from public, anon;
do $$ begin
  execute 'drop trigger if exists trg_audit on public.alert_rules';
  execute 'create trigger trg_audit after insert or update or delete on public.alert_rules for each row execute function private.audit()';
end $$;
notify pgrst, 'reload schema';
