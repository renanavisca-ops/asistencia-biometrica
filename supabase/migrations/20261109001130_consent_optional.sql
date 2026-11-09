-- Decisión del propietario (2026-11-09): el enrolamiento ya no exige un consentimiento individual registrado en la
-- plataforma. La empresa, al registrarse, acepta los términos y se compromete a tratar los datos conforme a la ley de su
-- país (incluidas las autorizaciones o avisos que esa ley exija). Si en el pasado se registró un consentimiento y luego se
-- retiró, el enrolamiento asociado deja de enviarse a los teléfonos (se conserva ese comportamiento).
alter table public.biometric_enrollments alter column consent_id drop not null;

create or replace function public.enroll_biometric(
  p_employee_id uuid, p_consent_id uuid, p_store_id uuid, p_identity_method text,
  p_samples text[], p_quality jsonb, p_pad_passed boolean, p_pad_score real,
  p_recognition_model_id uuid, p_pad_model_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_emp public.employees%rowtype; v_model public.model_versions%rowtype; v_enr uuid := gen_random_uuid();
  s text; v_bytes bytea; v_key text; v_ver uuid; v_limit int;
begin
  select * into v_emp from public.employees where id = p_employee_id;
  if not found or not private.has_org_perm('enrollment.manage', v_emp.organization_id) then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  if v_emp.status <> 'active' then raise exception 'empleado no activo'; end if;
  -- Límite del plan: empleados con rostro registrado (reenrolar a alguien ya enrolado no cuenta).
  v_limit := private.enroll_limit(v_emp.organization_id);
  if v_limit is not null and not exists (select 1 from public.biometric_enrollments where employee_id = p_employee_id and status = 'active')
     and private.enrolled_count(v_emp.organization_id) >= v_limit then
    raise exception 'Límite del plan alcanzado: % empleados con rostro registrado (su plan permite %). Para enrolar más, contrate el plan %.',
      private.enrolled_count(v_emp.organization_id), v_limit, private.tier_label(private.tier_max(v_limit + 1)) using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.stores where id = p_store_id and organization_id = v_emp.organization_id and is_central) then
    raise exception 'el enrolamiento solo se permite en una sede central de la organización';
  end if;
  -- Consentimiento individual opcional (la empresa responde del cumplimiento legal según los términos aceptados).
  if p_consent_id is not null and not exists (select 1 from public.biometric_consents where id = p_consent_id and employee_id = p_employee_id and withdrawn_at is null) then
    raise exception 'el consentimiento indicado no está vigente para este empleado';
  end if;
  -- Teléfono autorizado: la sesión del administrador debe estar ligada (bind_enroll_ticket) a un teléfono activo de la
  -- organización con permiso de enrolamiento vigente. Si en el panel se retira el permiso, deja de valer al instante.
  if not exists (select 1 from private.enroll_tickets t join public.devices d on d.id = t.device_id
                 where t.bound_user = auth.uid() and t.revoked_at is null and t.bound_at > now() - interval '4 hours'
                   and d.status = 'active' and d.can_enroll and d.organization_id = v_emp.organization_id) then
    raise exception 'teléfono no autorizado para enrolar: active «Puede enrolar» para este teléfono en el panel (Teléfonos)' using errcode = '42501';
  end if;
  -- Identidad: el número de documento escrito en el enrolamiento debe coincidir con el registrado (verify_employee_document, ≤ 30 min, un solo uso).
  update private.document_verifications set used_at = now()
   where id = (select id from private.document_verifications where employee_id = p_employee_id and verified_by = auth.uid()
                 and used_at is null and verified_at > now() - interval '30 minutes' order by verified_at desc limit 1)
  returning id into v_ver;
  if v_ver is null then raise exception 'identidad no verificada: escriba el número de documento del empleado (debe coincidir con el registrado)' using errcode = '42501'; end if;
  if p_pad_passed is not true then raise exception 'la prueba de vida no fue superada; enrolamiento rechazado'; end if;
  select * into v_model from public.model_versions where id = p_recognition_model_id and kind = 'recognition' and status <> 'retired';
  if not found or v_model.embedding_dim is null then raise exception 'modelo de reconocimiento no válido'; end if;
  if coalesce(array_length(p_samples, 1), 0) not between 3 and 10 then raise exception 'se requieren entre 3 y 10 muestras'; end if;
  if length(coalesce(trim(p_identity_method), '')) < 3 then raise exception 'método de verificación de identidad requerido'; end if;

  v_key := private.template_key();
  -- Reenrolamiento: la plantilla anterior queda sustituida y se elimina en los teléfonos en la siguiente sincronización.
  update public.biometric_enrollments set status = 'superseded', revoked_at = now(), revoked_reason = 'reenrolamiento'
   where employee_id = p_employee_id and status = 'active';
  update private.biometric_template_versions set revoked_at = now() where employee_id = p_employee_id and revoked_at is null;

  insert into public.biometric_enrollments (id, organization_id, employee_id, consent_id, enrolled_by, enrolled_at_store_id,
    identity_verification_method, sample_count, quality, pad_passed, pad_score, recognition_model_id, pad_model_id)
  values (v_enr, v_emp.organization_id, p_employee_id, p_consent_id, auth.uid(), p_store_id, p_identity_method,
          array_length(p_samples, 1), coalesce(p_quality, '{}'), true, p_pad_score, p_recognition_model_id, p_pad_model_id);

  foreach s in array p_samples loop
    v_bytes := decode(translate(s, '-_', '+/') || repeat('=', (4 - length(s) % 4) % 4), 'base64');
    if length(v_bytes) <> v_model.embedding_dim * 4 then
      raise exception 'dimensión de muestra inválida (esperado % float32)', v_model.embedding_dim;
    end if;
    insert into private.biometric_template_versions (organization_id, enrollment_id, employee_id, model_version_id, dims, key_id, ciphertext)
    values (v_emp.organization_id, v_enr, p_employee_id, p_recognition_model_id, v_model.embedding_dim, 'vault:template_enc_key',
            extensions.pgp_sym_encrypt(encode(v_bytes, 'base64'), v_key, 'cipher-algo=aes256'));
  end loop;
  return v_enr;
end $$;

drop function if exists private.device_roster(uuid, int);
create function private.device_roster(p_device_id uuid, p_lease_hours int)
returns table (employee_id uuid, display_name text, gender text, lease_expires_at timestamptz,
               last_event_id uuid, last_event_type public.attendance_event_type, last_event_at timestamptz, last_event_flags text[])
language sql stable security definer set search_path = '' as $$
  select e.id, e.first_name || ' ' || left(e.last_name, 1) || '.', e.gender,
         least(now() + make_interval(hours => p_lease_hours), min(a.valid_to)),
         le.id, le.event_type, le.occurred_at, le.decision_flags
  from public.devices d
  join public.employee_store_assignments a on a.store_id = d.store_id and a.revoked_at is null
       and a.valid_from <= now() and (a.valid_to is null or a.valid_to > now())
  join public.employees e on e.id = a.employee_id and e.status = 'active'
  join public.biometric_enrollments be on be.employee_id = e.id and be.status = 'active'
  left join public.biometric_consents c on c.id = be.consent_id
  left join lateral (select x.id, x.event_type, x.occurred_at, ev.decision_flags from public.attendance_events_effective x
                     join public.attendance_events ev on ev.id = x.id
                     where x.employee_id = e.id order by x.occurred_at desc, x.id desc limit 1) le on true
  where d.id = p_device_id and d.status = 'active' and (be.consent_id is null or c.withdrawn_at is null)
  group by e.id, e.first_name, e.last_name, e.gender, le.id, le.event_type, le.occurred_at, le.decision_flags;
$$;
revoke all on function private.device_roster(uuid, int) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function private.device_roster(uuid, int) to service_role';
  end if;
end $$;
notify pgrst, 'reload schema';
