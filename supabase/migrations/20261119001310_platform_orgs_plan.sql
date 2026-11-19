-- platform_orgs incluye el nombre del plan comercial aplicado.
drop function if exists public.platform_orgs();
create function public.platform_orgs() returns table (
  id uuid, name text, legal_name text, tax_id text, contact_email text, contact_phone text, platform_notes text,
  country_code char(2), timezone text, status text, access text, created_at timestamptz, created_via text,
  employees_active int, employees_enrolled int, stores int, devices_active int, punches_30d int, last_activity timestamptz,
  unlimited boolean, max_employees int, paid_until timestamptz, max_stores int, max_devices int, features jsonb,
  needed_tier_label text, plan_label text, over_limit boolean,
  admin_contacts text, support_until timestamptz, deletion_due_at timestamptz, suspended_reason text, plan_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_superadmin() then raise exception 'permiso denegado' using errcode = '42501'; end if;
  return query
  select o.id, o.name, o.legal_name, o.tax_id, o.contact_email, o.contact_phone, o.platform_notes,
    o.country_code, (select r.timezone from public.regions r where r.organization_id = o.id order by r.created_at limit 1),
    o.status, private.org_access(o.id), o.created_at, o.created_via,
    private.current_employee_count(o.id), private.enrolled_count(o.id),
    (select count(*)::int from public.stores s where s.organization_id = o.id and s.status = 'active'),
    (select count(*)::int from public.devices d where d.organization_id = o.id and d.status = 'active'),
    (select count(*)::int from public.attendance_events a where a.organization_id = o.id and a.received_at > now() - interval '30 days'),
    (select max(d.last_seen_at) from public.devices d where d.organization_id = o.id),
    o.unlimited, private.employee_limit(o.id), o.paid_until, o.max_stores, o.max_devices, o.features,
    private.tier_label(private.tier_max(greatest(private.current_employee_count(o.id), 1))),
    case when o.unlimited then 'Sin límite' when o.paid_max_employees is null then 'Gratis (1–5 empleados)' else 'Hasta ' || o.paid_max_employees || ' empleados' end,
    (not o.unlimited and private.current_employee_count(o.id) > coalesce(o.paid_max_employees, 5)),
    (select string_agg(a.display_name || ' <' || a.email || '>', ', ') from public.admin_role_grants g join public.admins a on a.user_id = g.user_id
      where g.organization_id = o.id and g.role = 'central_admin' and g.revoked_at is null),
    (select max(s.expires_at) from public.support_access s where s.organization_id = o.id and s.revoked_at is null and s.expires_at > now()),
    o.deletion_due_at, o.suspended_reason, (select p.name from public.platform_plans p where p.id = o.plan_id)
  from public.organizations o order by o.created_at;
end $$;
revoke execute on function public.platform_orgs() from public, anon;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'grant execute on function public.platform_orgs() to authenticated'; end if;
end $$;
notify pgrst, 'reload schema';
