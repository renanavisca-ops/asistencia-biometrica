-- Tarea diaria (03:15 UTC): borra definitivamente las organizaciones cuya eliminación venció (90 días).
-- Requiere pg_cron (disponible en Supabase). En el entorno local de pruebas no existe: se omite.
do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('purge-deleted-orgs', '15 3 * * *', 'select private.purge_due_orgs()');
  end if;
end $$;
