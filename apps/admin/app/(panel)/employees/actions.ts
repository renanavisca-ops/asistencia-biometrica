'use server';
import { supabaseServer } from '@/lib/supabase/server';
import { back, s } from '@/lib/actions';
import { humanError } from '@/lib/context';

export async function createEmployee(fd: FormData) {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc('create_employee', {
    p_org: s(fd, 'org'), p_first_name: s(fd, 'first_name'), p_last_name: s(fd, 'last_name'),
    p_document_type: s(fd, 'document_type'), p_document_country: s(fd, 'document_country'), p_document_number: s(fd, 'document_number'),
    p_hired_on: s(fd, 'hired_on'), p_store_id: s(fd, 'store_id'),
  });
  if (error || !data) back('/employees', fd, error, '');
  const r = data as { id: string; employeeCode: string };
  back(`/employees/${r.id}`, fd, null, `Empleado creado con código ${r.employeeCode}`);
}

export async function updateEmployee(fd: FormData) {
  const sb = await supabaseServer();
  const id = s(fd, 'id')!;
  const { error } = await sb.from('employees').update({ first_name: s(fd, 'first_name'), last_name: s(fd, 'last_name'), hired_on: s(fd, 'hired_on') }).eq('id', id);
  back(`/employees/${id}`, fd, error, 'Datos actualizados');
}

export async function setDocument(fd: FormData) {
  const sb = await supabaseServer();
  const id = s(fd, 'id')!;
  const { error } = await sb.rpc('set_employee_document', {
    p_employee_id: id, p_document_type: s(fd, 'document_type'), p_document_country: s(fd, 'document_country'),
    p_document_number: s(fd, 'document_number'), p_reason: s(fd, 'reason') ?? '',
  });
  back(`/employees/${id}`, fd, error, 'Documento registrado (cifrado)');
}

/** Devuelve el número en la respuesta (nunca en la URL). Queda auditado en el servidor. */
export async function revealDocument(_prev: { value?: string | null; error?: string } | null, fd: FormData) {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc('reveal_employee_document', { p_employee_id: s(fd, 'id'), p_reason: s(fd, 'reason') ?? '' });
  return error ? { error: humanError(error) } : { value: (data as string | null) ?? null };
}

export async function setStatus(fd: FormData) {
  const sb = await supabaseServer();
  const id = s(fd, 'id')!;
  const { error } = await sb.rpc('set_employee_status', { p_employee_id: id, p_status: s(fd, 'status'), p_reason: s(fd, 'reason') ?? '' });
  back(`/employees/${id}`, fd, error, 'Estado actualizado');
}

export async function transfer(fd: FormData) {
  const sb = await supabaseServer();
  const id = s(fd, 'id')!;
  const kind = s(fd, 'kind') ?? 'permanent';
  const from = s(fd, 'valid_from'), to = s(fd, 'valid_to');
  const { error } = await sb.rpc('transfer_employee', {
    p_employee_id: id, p_to_store_id: s(fd, 'store_id'), p_kind: kind,
    p_valid_from: from ? new Date(from).toISOString() : new Date().toISOString(),
    p_valid_to: to ? new Date(to).toISOString() : null, p_reason: s(fd, 'reason') ?? '',
  });
  back(`/employees/${id}`, fd, error, kind === 'permanent' ? 'Traslado registrado' : 'Asignación temporal registrada');
}

export async function revokeAssignment(fd: FormData) {
  const sb = await supabaseServer();
  const id = s(fd, 'id')!;
  const { error } = await sb.rpc('revoke_assignment', { p_assignment_id: s(fd, 'assignment_id'), p_reason: s(fd, 'reason') ?? '' });
  back(`/employees/${id}`, fd, error, 'Asignación revocada; los teléfonos la eliminarán en su próxima sincronización');
}

export async function recordConsent(fd: FormData) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  const id = s(fd, 'id')!;
  const { error } = await sb.from('biometric_consents').insert({
    organization_id: s(fd, 'org'), employee_id: id, legal_basis: s(fd, 'legal_basis'), notice_version: s(fd, 'notice_version'),
    accepted_at: new Date(s(fd, 'accepted_at') ?? Date.now()).toISOString(), evidence_ref: s(fd, 'evidence_ref'), recorded_by: user?.id,
  });
  back(`/employees/${id}`, fd, error, 'Consentimiento registrado');
}
