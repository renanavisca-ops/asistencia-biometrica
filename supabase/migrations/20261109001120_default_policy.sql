-- Toda organización nueva nace con una política de teléfono con umbrales PROVISIONALES (motor experimental SFace +
-- MiniFASNet; pendiente de calibración con voluntarios). Antes había que publicarla a mano y la app mostraba
-- «Reconocimiento sin calibrar». La organización puede ajustarla en el panel (Política offline).
create or replace function private.default_device_policy() returns jsonb language sql immutable set search_path = '' as $$
  select '{"leaseHours":168,"cooldownSec":30,"matchMargin":0.08,"padThreshold":0.8,"matchThreshold":0.4,"activeChallenge":1,
           "confirmationSec":4,"offlineMaxHours":72,"pauseMaxMinutes":150,"pauseMinMinutes":15,"longSessionHours":14,
           "maxFailedAttempts":5,"minSessionMinutes":30,"staleSessionHours":20,"antiDoubleWindowSec":120,
           "challengeTimeoutSec":8,"serverTimeStaleHours":48}'::jsonb;
$$;

create or replace function private.create_org(p_name text, p_country text, p_via text, p_unlimited boolean, p_terms text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prefix text;
begin
  if length(coalesce(trim(p_name), '')) < 2 then raise exception 'Escriba el nombre de la organización'; end if;
  if p_country !~ '^[A-Z]{2}$' then raise exception 'País no válido'; end if;
  v_prefix := left(upper(regexp_replace(private.normalize_document(p_name), '[^A-Z0-9]', '', 'g')) || 'ORG', 4);
  insert into public.organizations (name, employee_code_prefix, country_code, created_via, unlimited, terms_version, terms_accepted_at)
  values (trim(p_name), v_prefix, p_country, p_via, coalesce(p_unlimited, false), p_terms, case when p_terms is not null then now() end)
  returning id into v_org;
  insert into public.regions (organization_id, country_code, name, timezone) values (v_org, p_country, private.country_name(p_country), private.country_tz(p_country));
  -- Política inicial con umbrales PROVISIONALES del motor experimental (sin ella la app muestra «sin calibrar»).
  insert into public.device_policy_versions (organization_id, version, policy) values (v_org, 1, private.default_device_policy());
  return v_org;
end $$;

-- Organizaciones existentes sin política: se les asigna la inicial.
insert into public.device_policy_versions (organization_id, version, policy)
select o.id, 1, private.default_device_policy() from public.organizations o
 where not exists (select 1 from public.device_policy_versions p where p.organization_id = o.id);
revoke all on function private.default_device_policy() from public;
