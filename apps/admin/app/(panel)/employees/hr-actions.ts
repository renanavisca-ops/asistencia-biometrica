'use server';
import { supabaseServer } from '@/lib/supabase/server';
import { back, s } from '@/lib/actions';
import { humanError } from '@/lib/context';

const path = (fd: FormData) => `/employees/${s(fd, 'id')}`;

export async function terminate(fd: FormData) {
  const sb = await supabaseServer();
  const { error } = await sb.rpc('terminate_employee', {
    p_employee_id: s(fd, 'id'), p_end_type: s(fd, 'end_type'), p_effective_on: s(fd, 'effective_on'), p_reason: s(fd, 'reason') ?? '',
    p_comments: s(fd, 'comments'), p_notes: s(fd, 'notes'), p_cause_id: s(fd, 'cause_id'),
  });
  const future = (s(fd, 'effective_on') ?? '') > new Date().toISOString().slice(0, 10);
  back(path(fd), fd, error, future ? 'Baja programada: el empleado sigue activo hasta la fecha indicada.'
    : 'Baja registrada. Su enrolamiento quedó revocado y los teléfonos lo retirarán en la próxima sincronización.');
}

export async function rehire(fd: FormData) {
  const sb = await supabaseServer();
  const { error } = await sb.rpc('rehire_employee', { p_employee_id: s(fd, 'id'), p_started_on: s(fd, 'started_on'), p_store_id: s(fd, 'store_id'), p_notes: s(fd, 'notes') });
  back(path(fd), fd, error, 'Recontratación registrada (nuevo período laboral). Debe volver a enrolar su rostro para que pueda marcar.');
}

export async function suspend(fd: FormData) {
  const sb = await supabaseServer();
  const { error } = await sb.rpc('suspend_employee', { p_employee_id: s(fd, 'id'), p_from: s(fd, 'from'), p_until: s(fd, 'until'), p_reason: s(fd, 'reason') ?? '' });
  back(path(fd), fd, error, 'Suspensión registrada');
}

export async function reinstate(fd: FormData) {
  const sb = await supabaseServer();
  const { error } = await sb.rpc('reinstate_employee', { p_employee_id: s(fd, 'id'), p_notes: s(fd, 'notes') });
  back(path(fd), fd, error, 'Reintegro registrado');
}

export async function createRecord(fd: FormData) {
  const sb = await supabaseServer();
  const { error } = await sb.rpc('create_disciplinary_record', {
    p_employee_id: s(fd, 'id'), p_kind: s(fd, 'kind') ?? 'disciplinary', p_incident_date: s(fd, 'incident_date'), p_category_id: s(fd, 'category_id'),
    p_measure: s(fd, 'measure'), p_description: s(fd, 'description') ?? '', p_admin_comments: s(fd, 'admin_comments'),
    p_employee_informed: fd.get('employee_informed') === 'on', p_store_id: s(fd, 'store_id'),
  });
  back(path(fd), fd, error, s(fd, 'kind') === 'recognition' ? 'Reconocimiento registrado' : 'Registro disciplinario creado');
}

export async function followupRecord(fd: FormData) {
  const sb = await supabaseServer();
  const { error } = await sb.rpc('followup_disciplinary_record', { p_record_id: s(fd, 'record_id'), p_status: s(fd, 'status'), p_comment: s(fd, 'comment') ?? '' });
  back(s(fd, 'return') ?? path(fd), fd, error, 'Seguimiento registrado');
}

export async function voidRecord(fd: FormData) {
  const sb = await supabaseServer();
  const { error } = await sb.rpc('void_disciplinary_record', { p_record_id: s(fd, 'record_id'), p_reason: s(fd, 'reason') ?? '' });
  back(path(fd), fd, error, 'Registro anulado (se conserva en el historial)');
}

export async function voidDocument(fd: FormData) {
  const sb = await supabaseServer();
  const { error } = await sb.rpc('void_hr_document', { p_document_id: s(fd, 'document_id'), p_reason: s(fd, 'reason') ?? '' });
  back(path(fd), fd, error, 'Documento anulado (se conserva en el historial)');
}

/** Registra un archivo ya subido al bucket privado desde el navegador (el servidor valida la ruta y el permiso). */
export async function registerDocument(input: { employeeId: string; relatedType: string; docType: string; fileName: string; path: string; size: number; mime: string }) {
  const sb = await supabaseServer();
  const { error } = await sb.rpc('register_hr_document', {
    p_employee_id: input.employeeId, p_related_type: input.relatedType, p_related_id: null, p_doc_type: input.docType,
    p_file_name: input.fileName, p_storage_path: input.path, p_size: input.size, p_mime: input.mime,
  });
  // Si el registro falla, el archivo queda sin documento: la limpieza diaria lo detecta (más de 24 h sin registro)
  // y lo borra con la API de Storage (ver migración 20261120001400).
  if (error) return { error: humanError(error) };
  return { ok: true };
}
