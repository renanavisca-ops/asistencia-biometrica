-- Consulta del permiso propio (para el panel: exportación de reportes). Solo responde sobre la sesión que llama.
create or replace function public.my_org_perm(p_perm text, p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select private.has_org_perm(p_perm, p_org); $$;
revoke execute on function public.my_org_perm(text, uuid) from public, anon;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.my_org_perm(text, uuid) to authenticated';
  end if;
end $$;
