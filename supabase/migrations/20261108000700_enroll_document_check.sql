-- Enrolamiento: verificación del documento de identidad contra el registrado (cifrado) antes de guardar el rostro.
-- Corrige: se podía enrolar a una persona escribiendo cualquier texto/número (incluso el documento de otro empleado).

create table private.document_verifications (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  verified_by uuid not null,
  verified_at timestamptz not null default now(),
  used_at timestamptz
);
create index on private.document_verifications (employee_id, verified_by, verified_at desc);
alter table private.document_verifications enable row level security; -- sin políticas: solo funciones definer

-- Compara el número escrito con el documento del empleado (HMAC, sin descifrar). Máx. 5 intentos fallidos por empleado cada 15 min.
create or replace function public.verify_employee_document(p_employee_id uuid, p_document_number text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_emp public.employees%rowtype; v_doc private.employee_documents%rowtype; v_fp text; v_norm text := private.normalize_document(p_document_number); v_other text;
begin
  select * into v_emp from public.employees where id = p_employee_id;
  if not found or not private.has_org_perm('enrollment.manage', v_emp.organization_id) then raise exception 'permiso denegado' using errcode = '42501'; end if;
  select * into v_doc from private.employee_documents where employee_id = p_employee_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_document', 'message', 'El empleado no tiene documento registrado. Regístrelo en el panel (Empleados) antes de enrolar.');
  end if;
  if (select count(*) from public.security_events where kind = 'enroll_document_mismatch' and details ->> 'employee_id' = p_employee_id::text
        and created_at > now() - interval '15 minutes') >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'throttled', 'message', 'Demasiados intentos fallidos con este empleado. Espere 15 minutos.');
  end if;
  v_fp := encode(extensions.hmac(v_doc.document_type || '|' || v_doc.document_country || '|' || v_norm, private.pii_key(), 'sha256'), 'hex');
  if v_fp = v_doc.fingerprint then
    insert into private.document_verifications (employee_id, verified_by) values (p_employee_id, auth.uid());
    insert into public.audit_log (organization_id, actor, actor_kind, action, entity, entity_id, after)
    values (v_emp.organization_id, auth.uid(), 'admin', 'verify_employee_document', 'employees', p_employee_id::text, jsonb_build_object('result', 'match'));
    return jsonb_build_object('ok', true);
  end if;
  -- ¿Es el documento de OTRO empleado de la organización? (posible suplantación) — se informa el código, nunca el número.
  select e.employee_code into v_other from private.employee_documents d join public.employees e on e.id = d.employee_id
   where d.organization_id = v_emp.organization_id and d.employee_id <> p_employee_id
     and d.fingerprint = encode(extensions.hmac(d.document_type || '|' || d.document_country || '|' || v_norm, private.pii_key(), 'sha256'), 'hex')
   limit 1;
  insert into public.security_events (organization_id, actor, kind, details)
  values (v_emp.organization_id, auth.uid(), 'enroll_document_mismatch', jsonb_build_object('employee_id', p_employee_id, 'belongs_to', v_other));
  return jsonb_build_object('ok', false, 'reason', case when v_other is null then 'mismatch' else 'other_employee' end,
    'message', case when v_other is null then 'El número no coincide con el documento registrado de este empleado (termina en ' || coalesce(v_emp.document_last4, '????') || ').'
               else 'Ese documento pertenece a otro empleado (#' || v_other || '). Enrolamiento bloqueado.' end);
end $$;

create or replace function public.enroll_biometric(
  p_employee_id uuid, p_consent_id uuid, p_store_id uuid, p_identity_method text,
  p_samples text[], p_quality jsonb, p_pad_passed boolean, p_pad_score real,
  p_recognition_model_id uuid, p_pad_model_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_emp public.employees%rowtype; v_model public.model_versions%rowtype; v_enr uuid := gen_random_uuid();
  s text; v_bytes bytea; v_key text; v_ver uuid;
begin
  select * into v_emp from public.employees where id = p_employee_id;
  if not found or not private.has_org_perm('enrollment.manage', v_emp.organization_id) then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  if v_emp.status <> 'active' then raise exception 'empleado no activo'; end if;
  if not exists (select 1 from public.stores where id = p_store_id and organization_id = v_emp.organization_id and is_central) then
    raise exception 'el enrolamiento solo se permite en una sede central de la organización';
  end if;
  if not exists (select 1 from public.biometric_consents where id = p_consent_id and employee_id = p_employee_id and withdrawn_at is null) then
    raise exception 'no existe consentimiento vigente para este empleado';
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

revoke execute on function public.verify_employee_document(uuid, text) from public, anon;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.verify_employee_document(uuid, text) to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on private.document_verifications to service_role';
  end if;
end $$;

-- Limpieza: versiones anteriores de la app permitían escribir texto libre como "método de verificación";
-- si alguien escribió un número de documento, quedaba en claro. Se reemplaza por un texto neutro.
update public.biometric_enrollments
   set identity_verification_method = 'Texto libre retirado por privacidad (verificación de documento no comprobada)'
 where identity_verification_method ~ '[0-9]{5,}';
