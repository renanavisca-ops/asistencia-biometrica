export const fmtDateTime = (iso: string | null | undefined, tz?: string) =>
  iso ? new Intl.DateTimeFormat('es', { dateStyle: 'short', timeStyle: 'medium', timeZone: tz }).format(new Date(iso)) : '—';
export const fmtDuration = (seconds: number | null | undefined) => {
  if (seconds == null) return '—';
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
  return `${h} h ${String(m).padStart(2, '0')} min`;
};
export const ago = (iso: string | null | undefined) => {
  if (!iso) return 'nunca';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return 'hace un momento';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} días`;
};
export const EVENT_LABEL: Record<string, string> = { IN: 'Entrada', OUT: 'Salida' };
export const STATE_LABEL: Record<string, string> = { open: 'Abierta', closed: 'Cerrada', missing_out: 'Salida omitida', orphan_out: 'Salida sin entrada' };
export const INCIDENT_LABEL: Record<string, string> = {
  missing_out: 'Salida omitida', orphan_out: 'Salida sin entrada', duplicate: 'Duplicado', offline_conflict: 'Conflicto offline',
  recognition_failed: 'Reconocimiento fallido', clock_anomaly: 'Reloj anómalo', long_open_session: 'Sesión abierta prolongada',
  unassigned_store: 'Sede no asignada', inactive_employee: 'Empleado inactivo', signature_invalid: 'Firma inválida',
  sequence_gap: 'Hueco de secuencia', sequence_conflict: 'Conflicto de secuencia (posible clon)', cross_store_session: 'Cambio de sede',
  device_offline: 'Dispositivo desconectado',
};
