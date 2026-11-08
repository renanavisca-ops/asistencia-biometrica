-- =====================================================================================
-- Códigos de empleado automáticos por organización y documento de identidad cifrado.
-- - Código: <prefijo>-<consecutivo de 6 dígitos>, único en la organización; se conserva en traslados.
-- - Documento: cifrado (AES-256, clave 'pii_enc_key' en Vault) en private.employee_documents;
--   huella HMAC-SHA256 con clave secreta para impedir duplicados; el panel solo ve tipo y últimos 4.
-- =====================================================================================

alter table public.organizations
  add column employee_code_prefix text not null default 'EMP' check (employee_code_prefix ~ '^[A-Z0-9]{2,6}$'),
  add column next_employee_number int not null default 1 check (next_employee_number > 0);

alter table public.employees
  add column document_type text check (document_type in ('DPI', 'CEDULA', 'DUI', 'DNI', 'DIMEX', 'PASAPORTE', 'OTRO')),
  add column document_country char(2) check (document_country ~ '^[A-Z]{2}$');

create table private.employee_documents (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  organization_id uuid not null,
  document_type text not null,
  document_country char(2) not null,
  ciphertext bytea not null,
  fingerprint text not null, -- HMAC-SHA256(clave, tipo|país|número normalizado)
  updated_at timestamptz not null default now(),
  unique (organization_id, fingerprint)
);
alter table private.employee_documents enable row level security; -- sin políticas: solo funciones definer

-- Clave de cifrado de datos personales (independiente de la de plantillas biométricas).
create or replace function private.pii_key() returns text
language plpgsql stable security definer set search_path = '' as $$
declare k text;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'pii_enc_key' limit 1;
  if k is null or length(k) < 32 then raise exception 'pii_enc_key no configurada en Vault'; end if;
  return k;
end $$;

create or replace function private.normalize_document(p text) returns text
language sql immutable set search_path = '' as $$ select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) $$;

-- Asignación automática del código (bloquea la fila de la organización: sin huecos por concurrencia).
create or replace function private.assign_employee_code() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_prefix text; v_n int;
begin
  if new.employee_code is null or new.employee_code = '' then
    update public.organizations set next_employee_number = next_employee_number + 1
     where id = new.organization_id returning employee_code_prefix, next_employee_number - 1 into v_prefix, v_n;
    new.employee_code := v_prefix || '-' || lpad(v_n::text, 6, '0');
  end if;
  return new;
end $$;
create trigger trg_assign_employee_code before insert on public.employees
  for each row execute function private.assign_employee_code();

-- Código inmutable una vez asignado.
create or replace function private.immutable_employee_code() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.employee_code is distinct from old.employee_code then raise exception 'El código de empleado no se puede modificar' using errcode = '42501'; end if;
  return new;
end $$;
create trigger trg_immutable_employee_code before update on public.employees
  for each row execute function private.immutable_employee_code();

-- Guarda/reemplaza el documento cifrado. Devuelve error legible si el documento ya pertenece a otro empleado.
create or replace function private.store_employee_document(p_employee uuid, p_org uuid, p_type text, p_country text, p_number text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_norm text := private.normalize_document(p_number); v_key text := private.pii_key(); v_fp text; v_other text;
begin
  if p_type not in ('DPI', 'CEDULA', 'DUI', 'DNI', 'DIMEX', 'PASAPORTE', 'OTRO') then raise exception 'Tipo de documento no válido'; end if;
  if p_country !~ '^[A-Z]{2}$' then raise exception 'País del documento no válido'; end if;
  if length(v_norm) < 5 or length(v_norm) > 20 then raise exception 'Número de documento no válido (5 a 20 caracteres alfanuméricos)'; end if;
  if p_type = 'DPI' and v_norm !~ '^[0-9]{13}$' then raise exception 'El DPI debe tener 13 dígitos'; end if;
  v_fp := encode(extensions.hmac(p_type || '|' || p_country || '|' || v_norm, v_key, 'sha256'), 'hex');
  select e.employee_code into v_other from private.employee_documents d join public.employees e on e.id = d.employee_id
   where d.organization_id = p_org and d.fingerprint = v_fp and d.employee_id <> p_employee;
  if v_other is not null then raise exception 'Ese documento ya está registrado para el empleado %', v_other using errcode = '23505'; end if;
  insert into private.employee_documents (employee_id, organization_id, document_type, document_country, ciphertext, fingerprint)
  values (p_employee, p_org, p_type, p_country, extensions.pgp_sym_encrypt(v_norm, v_key, 'cipher-algo=aes256'), v_fp)
  on conflict (employee_id) do update set document_type = excluded.document_type, document_country = excluded.document_country,
    ciphertext = excluded.ciphertext, fingerprint = excluded.fingerprint, updated_at = now();
  update public.employees set document_type = p_type, document_country = p_country, document_last4 = right(v_norm, 4) where id = p_employee;
end $$;

-- Alta de empleado (única vía desde el panel).
create or replace function public.create_employee(
  p_org uuid, p_first_name text, p_last_name text, p_document_type text, p_document_country text, p_document_number text,
  p_hired_on date default null, p_store_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid := gen_random_uuid(); v_code text;
begin
  if not private.has_org_perm('employee.manage', p_org) then raise exception 'permiso denegado' using errcode = '42501'; end if;
  if length(coalesce(trim(p_first_name), '')) < 1 or length(coalesce(trim(p_last_name), '')) < 1 then raise exception 'Nombre y apellido son obligatorios'; end if;
  if p_store_id is not null and not private.has_org_perm('assignment.manage', p_org) then raise exception 'permiso denegado' using errcode = '42501'; end if;
  insert into public.employees (id, organization_id, first_name, last_name, hired_on, created_by)
  values (v_id, p_org, trim(p_first_name), trim(p_last_name), p_hired_on, auth.uid()) returning employee_code into v_code;
  if p_document_number is not null and trim(p_document_number) <> '' then
    perform private.store_employee_document(v_id, p_org, p_document_type, p_document_country, p_document_number);
  end if;
  if p_store_id is not null then
    insert into public.employee_store_assignments (organization_id, employee_id, store_id, kind, created_by, reason)
    values (p_org, v_id, p_store_id, 'permanent', auth.uid(), 'alta');
  end if;
  return jsonb_build_object('id', v_id, 'employeeCode', v_code);
end $$;

create or replace function public.set_employee_document(p_employee_id uuid, p_document_type text, p_document_country text, p_document_number text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_emp public.employees%rowtype;
begin
  select * into v_emp from public.employees where id = p_employee_id;
  if not found or not private.has_org_perm('employee.manage', v_emp.organization_id) then raise exception 'permiso denegado' using errcode = '42501'; end if;
  if length(coalesce(trim(p_reason), '')) < 5 then raise exception 'motivo requerido'; end if;
  perform private.store_employee_document(p_employee_id, v_emp.organization_id, p_document_type, p_document_country, p_document_number);
  insert into public.audit_log (organization_id, actor, actor_kind, action, entity, entity_id, after)
  values (v_emp.organization_id, auth.uid(), 'admin', 'set_employee_document', 'employees', p_employee_id::text,
          jsonb_build_object('document_type', p_document_type, 'document_country', p_document_country, 'reason', p_reason));
end $$;

-- Consulta del número completo: solo administración central/superadmin, con motivo y auditoría.
create or replace function public.reveal_employee_document(p_employee_id uuid, p_reason text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_emp public.employees%rowtype; v_doc private.employee_documents%rowtype;
begin
  select * into v_emp from public.employees where id = p_employee_id;
  if not found or not private.has_org_perm('employee.manage', v_emp.organization_id) then raise exception 'permiso denegado' using errcode = '42501'; end if;
  if length(coalesce(trim(p_reason), '')) < 10 then raise exception 'Indique el motivo (mín. 10 caracteres)'; end if;
  select * into v_doc from private.employee_documents where employee_id = p_employee_id;
  if not found then return null; end if;
  insert into public.audit_log (organization_id, actor, actor_kind, action, entity, entity_id, after)
  values (v_emp.organization_id, auth.uid(), 'admin', 'reveal_employee_document', 'employees', p_employee_id::text, jsonb_build_object('reason', p_reason));
  return extensions.pgp_sym_decrypt(v_doc.ciphertext, private.pii_key());
end $$;

-- El alta directa por API queda cerrada: solo create_employee. Actualización directa limitada a nombre y fecha de ingreso.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke insert, update on public.employees from authenticated';
    execute 'grant update (first_name, last_name, hired_on) on public.employees to authenticated';
    execute 'grant execute on function public.create_employee(uuid, text, text, text, text, text, date, uuid),
      public.set_employee_document(uuid, text, text, text, text), public.reveal_employee_document(uuid, text) to authenticated';
  end if;
end $$;
revoke execute on function public.create_employee(uuid, text, text, text, text, text, date, uuid), public.set_employee_document(uuid, text, text, text, text),
  public.reveal_employee_document(uuid, text) from public, anon;
revoke all on function private.pii_key(), private.store_employee_document(uuid, uuid, text, text, text), private.assign_employee_code(),
  private.normalize_document(text), private.immutable_employee_code() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on private.employee_documents to service_role';
  end if;
end $$;

-- Al borrar datos personales por derecho de supresión también debe borrarse el documento (ver decide_retention_request; ejecución manual hoy).
