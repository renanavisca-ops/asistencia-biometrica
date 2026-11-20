-- Umbrales de reconocimiento más seguros (2026-11-20). En producción un hombre no enrolado fue aceptado como una
-- empleada con similitud 0,538 (umbral provisional 0,40, margen 0,08). Medición real con las 27 plantillas enroladas:
-- misma persona ≈ 0,89 de promedio; personas distintas, máximo 0,465. Nuevo valor: coincidencia 0,62 y margen 0,12
-- (además, la app 0.7.1 promedia las 3 plantillas más parecidas y exige que las dos capturas coincidan).
create or replace function private.default_device_policy() returns jsonb language sql immutable set search_path = '' as $$
  select '{"leaseHours":168,"cooldownSec":30,"matchMargin":0.12,"padThreshold":0.8,"matchThreshold":0.62,"activeChallenge":1,
           "confirmationSec":4,"offlineMaxHours":72,"pauseMaxMinutes":150,"pauseMinMinutes":15,"longSessionHours":14,
           "maxFailedAttempts":5,"minSessionMinutes":30,"staleSessionHours":20,"antiDoubleWindowSec":120,
           "challengeTimeoutSec":8,"serverTimeStaleHours":48}'::jsonb;
$$;

-- Organizaciones cuya política vigente conserva los umbrales provisionales anteriores (o más bajos): nueva versión
-- con los umbrales seguros, conservando el resto de su configuración. Las que ya publicaron valores más altos no cambian.
insert into public.device_policy_versions (organization_id, version, policy)
select p.organization_id, p.version + 1,
       p.policy || jsonb_build_object('matchThreshold', greatest(coalesce((p.policy ->> 'matchThreshold')::numeric, 0), 0.62),
                                      'matchMargin', greatest(coalesce((p.policy ->> 'matchMargin')::numeric, 0), 0.12))
from public.device_policy_versions p
where p.version = (select max(version) from public.device_policy_versions x where x.organization_id = p.organization_id)
  and (coalesce((p.policy ->> 'matchThreshold')::numeric, 0) < 0.62 or coalesce((p.policy ->> 'matchMargin')::numeric, 0) < 0.12)
  and p.policy ? 'matchThreshold' and (p.policy ->> 'matchThreshold') is not null;
