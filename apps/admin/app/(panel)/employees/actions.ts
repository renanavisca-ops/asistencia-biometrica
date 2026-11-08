'use server';
import { supabaseServer } from '@/lib/supabase/server';
import { back, s } from '@/lib/actions';

export async function createEmployee(fd: FormData) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  const { data, error } = await sb.from('employees').insert({
    organization_id: s(fd, 'org'), employee_code: s(fd, 'employee_code'), first_name: s(fd, 'first_name'),
    last_name: s(fd, 'last_name'), document_last4: s(fd, 'document_last4'), hired_on: s(fd, 'hired_on'), created_by: user?.id,
  }).select('id').single();
  if (error || !data) back('/employees', fd, error, '');
  const store = s(fd, 'store_id');
  if (store) {
    const { error: e2 } = await sb.from('employee_store_assignments').insert({
      organization_id: s(fd, 'org'), employee_id: data.id, store_id: store, kind: 'permanent', created_by: user?.id, reason: 'alta',
    });
    if (e2) back(`/employees/${data.id}`, fd, e2, '');
  }
  back(`/employees/${data.id}`, fd, null, 'Empleado creado');
}

export async function updateEmployee(fd: FormData) {
  const sb = await supabaseServer();
  const id = s(fd, 'id')!;
  const { error } = await sb.from('employees').update({
    first_name: s(fd, 'first_name'), last_name: s(fd, 'last_name'), employee_code: s(fd, 'employee_code'), document_last4: s(fd, 'document_last4'),
  }).eq('id', id);
  back(`/employees/${id}`, fd, error, 'Datos actualizados');
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
