/** Etiquetas del módulo de personal (ciclo laboral, expediente, horarios y alertas). */
export const END_TYPE: Record<string, string> = {
  resignation: 'Renuncia', dismissal: 'Despido', contract_end: 'Finalización de contrato', mutual_agreement: 'Mutuo acuerdo', other: 'Otra causa',
};
export const EMP_STATUS: Record<string, [string, string]> = { active: ['Activo', 'ok'], suspended: ['Suspendido', 'warn'], terminated: ['Dado de baja', 'err'] };
export const EMP_EVENT: Record<string, string> = {
  hire: 'Contratación', rehire: 'Recontratación', termination: 'Baja', termination_scheduled: 'Baja programada',
  suspension: 'Suspensión', reinstatement: 'Reintegro', note: 'Nota',
};
export const MEASURE: Record<string, string> = { verbal: 'Llamada de atención verbal', written: 'Llamada de atención escrita', suspension: 'Suspensión', other: 'Otra medida' };
export const DISC_STATUS: Record<string, [string, string]> = {
  pending: ['Pendiente', 'warn'], in_review: ['En revisión', 'warn'], communicated: ['Comunicado', ''], resolved: ['Resuelto', 'ok'],
  closed: ['Cerrado', 'ok'], voided: ['Anulado', 'err'],
};
export const ALERT_STATUS: Record<string, [string, string]> = {
  pending: ['Pendiente', 'warn'], reviewed: ['Revisada', 'ok'], dismissed: ['Descartada', ''], closed: ['Cerrada', 'ok'],
};
export const ALERT_EVENT: Record<string, string> = { created: 'Creada', count_changed: 'Conteo actualizado', comment: 'Comentario', status: 'Cambio de estado' };
export const WEEKDAYS: [number, string][] = [[1, 'Lunes'], [2, 'Martes'], [3, 'Miércoles'], [4, 'Jueves'], [5, 'Viernes'], [6, 'Sábado'], [7, 'Domingo']];
export const EXC_KIND: Record<string, string> = { day_off: 'Día libre', permit: 'Permiso', custom: 'Horario especial' };
export const DOC_KIND: Record<string, string> = { general: 'General', termination: 'Salida', disciplinary: 'Disciplina', hire: 'Contratación' };

export const fmtDate = (d: string | null | undefined) => (d ? new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('es') : '—');
export const fmtTime = (iso: string | null | undefined, tz?: string) =>
  iso ? new Intl.DateTimeFormat('es', { timeStyle: 'short', timeZone: tz }).format(new Date(iso)) : '—';
/** Fecha local (YYYY-MM-DD) en la zona horaria indicada. */
export const localDate = (d: Date, tz = 'America/Guatemala') => d.toLocaleDateString('sv-SE', { timeZone: tz });
export const monthStart = (ym: string) => `${ym}-01`;
export const monthEnd = (ym: string) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
