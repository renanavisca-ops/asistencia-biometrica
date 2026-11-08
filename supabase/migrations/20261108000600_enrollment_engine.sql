-- =====================================================================================
-- Etapa 3: enrolamiento con el motor real.
-- - Registro de los modelos gratuitos EXPERIMENTALES.
-- - Decodificación de plantillas float32 y control de duplicados 1:N dentro de la organización (en el servidor:
--   las plantillas de otras personas nunca se envían al teléfono que enrola).
-- =====================================================================================

insert into public.model_versions (kind, name, version, vendor, license, embedding_dim, status, notes) values
  ('recognition', 'sface', '2021dec', 'OpenCV Zoo', 'Apache-2.0 (pesos); procedencia de datos de entrenamiento NO verificada', 128, 'evaluation',
   'EXPERIMENTAL. MobileFaceNet + pérdida SFace. No usar comercialmente sin revisión legal.'),
  ('pad', 'minifasnet-v2+v1se', 'silentface', 'Minivision (Silent-Face)', 'Apache-2.0 (código); licencia de pesos/datos no explícita', null, 'evaluation',
   'EXPERIMENTAL. Prueba de vida pasiva no certificada; se combina con desafío activo.')
on conflict (kind, name, version) do nothing;

-- float32 little-endian (bytea) → float8[]
create or replace function private.f32le_to_array(b bytea) returns float8[]
language plpgsql immutable strict set search_path = '' as $$
declare n int := length(b) / 4; out float8[] := array_fill(0::float8, array[n]); i int; v bigint; e int; m bigint; s int; f float8;
begin
  for i in 0 .. n - 1 loop
    v := get_byte(b, i*4)::bigint | (get_byte(b, i*4+1)::bigint << 8) | (get_byte(b, i*4+2)::bigint << 16) | (get_byte(b, i*4+3)::bigint << 24);
    s := (v >> 31)::int; e := ((v >> 23) & 255)::int; m := v & 8388607;
    if e = 0 then f := m::float8 * power(2::float8, -149);
    elsif e = 255 then f := 'NaN'::float8;
    else f := (1 + m::float8 / 8388608) * power(2::float8, e - 127); end if;
    out[i + 1] := case when s = 1 then -f else f end;
  end loop;
  return out;
end $$;

create or replace function private.cosine(a float8[], b float8[]) returns float8
language sql immutable strict set search_path = '' as $$
  select sum(x * y) / nullif(sqrt(sum(x * x)) * sqrt(sum(y * y)), 0) from unnest(a, b) as t(x, y)
$$;

-- Busca en la organización plantillas vigentes del mismo modelo que se parezcan a las nuevas muestras.
-- Devuelve solo código, nombre y puntuación (nunca plantillas). Requiere enrollment.manage + MFA.
create or replace function public.check_biometric_duplicate(p_employee_id uuid, p_samples text[], p_recognition_model_id uuid, p_threshold float8)
returns table (employee_code text, employee_name text, score float8)
language plpgsql security definer set search_path = '' as $$
declare v_emp public.employees%rowtype; v_key text; probes float8[][]; s text;
begin
  select * into v_emp from public.employees where id = p_employee_id;
  if not found or not private.has_org_perm('enrollment.manage', v_emp.organization_id) then raise exception 'permiso denegado' using errcode = '42501'; end if;
  if p_threshold is null or p_threshold <= 0 or p_threshold >= 1 then raise exception 'umbral de duplicado inválido'; end if;
  v_key := private.template_key();
  return query
  with probe as (
    select private.f32le_to_array(decode(translate(x, '-_', '+/') || repeat('=', (4 - length(x) % 4) % 4), 'base64')) v
    from unnest(p_samples) x
  ), cand as (
    select t.employee_id, private.f32le_to_array(decode(extensions.pgp_sym_decrypt(t.ciphertext, v_key), 'base64')) v
    from private.biometric_template_versions t
    join public.biometric_enrollments be on be.id = t.enrollment_id and be.status = 'active'
    where t.organization_id = v_emp.organization_id and t.model_version_id = p_recognition_model_id
      and t.revoked_at is null and t.employee_id <> p_employee_id
  )
  select e.employee_code, e.first_name || ' ' || e.last_name, max(private.cosine(p.v, c.v))
  from cand c cross join probe p join public.employees e on e.id = c.employee_id
  group by e.employee_code, e.first_name, e.last_name
  having max(private.cosine(p.v, c.v)) >= p_threshold
  order by 3 desc;
end $$;

-- Sede central de la organización del empleado (el enrolamiento siempre se registra a su nombre).
create or replace function public.central_store_for(p_org uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.stores where organization_id = p_org and is_central and status = 'active'
    and private.has_org_perm('enrollment.manage', p_org) order by created_at limit 1
$$;

revoke all on function private.f32le_to_array(bytea), private.cosine(float8[], float8[]) from public;
revoke execute on function public.check_biometric_duplicate(uuid, text[], uuid, float8), public.central_store_for(uuid) from public, anon;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.check_biometric_duplicate(uuid, text[], uuid, float8), public.central_store_for(uuid) to authenticated';
  end if;
end $$;
