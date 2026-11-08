/** Tipos compartidos entre la app de tienda (kiosk), las Edge Functions y el panel. */

export type EventType = 'IN' | 'OUT';

export type ClockFlag =
  | 'clock_regression' // la hora de pared retrocedió respecto al último evento conocido
  | 'clock_jump_forward' // la hora de pared avanzó mucho más que el reloj monotónico
  | 'timezone_changed'
  | 'reboot_since_server_sync' // no hay referencia monotónica válida desde la última hora de servidor
  | 'stale_server_time' // demasiado tiempo sin referencia de hora de servidor
  | 'no_server_time'; // el dispositivo nunca ha recibido hora de servidor

export type DecisionFlag =
  | ClockFlag
  | 'stale_open_session' // la sesión previa llevaba abierta más del umbral: se registra ENTRADA y se abre incidencia de salida omitida
  | 'long_session_out' // salida tras una permanencia larga pero dentro del umbral de caducidad
  | 'early_out_confirmed'; // salida antes del tiempo mínimo, confirmada por la persona en pantalla

/** Política operativa que el servidor distribuye a cada dispositivo (versionada). */
export interface DevicePolicy {
  version: number;
  /** Ventana anti-doble-marcación en segundos: un segundo reconocimiento dentro de la ventana no alterna el estado. */
  antiDoubleWindowSec: number;
  /**
   * Minutos tras una ENTRADA durante los cuales una nueva marcación NO registra salida directamente: la app pide
   * confirmación («Entró hace 2 min. ¿Registrar SALIDA?»). Evita salidas por marcar dos veces sin impedir salidas reales.
   */
  minSessionMinutes: number;
  /** Rango (minutos) en que una salida seguida de entrada se considera pausa/almuerzo dentro de la misma jornada. */
  pauseMinMinutes: number;
  pauseMaxMinutes: number;
  /** Horas a partir de las cuales una permanencia se marca como larga (solo aviso/revisión). */
  longSessionHours: number;
  /**
   * Horas a partir de las cuales una sesión abierta se considera caducada: la siguiente marcación se registra
   * como ENTRADA y la sesión previa queda como "salida omitida" para revisión. No se cierra por medianoche.
   */
  staleSessionHours: number;
  /** Horas máximas sin sincronizar antes de bloquear la marcación (0 = no bloquear, solo alertar). */
  offlineMaxHours: number;
  /** Horas de validez del permiso (lease) de cada empleado en el dispositivo sin renovarse. */
  leaseHours: number;
  /** Horas sin hora de servidor tras las cuales los eventos se marcan como de hora dudosa. */
  serverTimeStaleHours: number;
  /** Umbral de similitud para aceptar coincidencia 1:N (depende del modelo; calibrar). */
  matchThreshold: number;
  /** Margen mínimo entre el mejor y el segundo mejor candidato. */
  matchMargin: number;
  /** Umbral mínimo de puntuación PAD (prueba de vida) del modelo activo. */
  padThreshold: number;
  /** 1 = exigir desafío activo aleatorio (parpadeo/giro) además de la prueba pasiva; 0 = solo pasiva (seguridad reducida). */
  activeChallenge: number;
  /** Segundos para completar el desafío activo. */
  challengeTimeoutSec: number;
  /** Intentos fallidos consecutivos antes de enfriamiento. */
  maxFailedAttempts: number;
  cooldownSec: number;
  /** Segundos que se muestra la confirmación antes de volver a la pantalla inicial. */
  confirmationSec: number;
}

export const DEFAULT_POLICY: DevicePolicy = {
  version: 1,
  antiDoubleWindowSec: 120,
  minSessionMinutes: 30,
  pauseMinMinutes: 15,
  pauseMaxMinutes: 150,
  longSessionHours: 14,
  staleSessionHours: 20,
  offlineMaxHours: 72,
  leaseHours: 168,
  serverTimeStaleHours: 48,
  matchThreshold: Number.NaN, // sin calibrar: obliga a configurar por modelo
  matchMargin: Number.NaN,
  padThreshold: Number.NaN,
  activeChallenge: 1,
  challengeTimeoutSec: 8,
  maxFailedAttempts: 5,
  cooldownSec: 30,
  confirmationSec: 4,
};

/** Evento de asistencia tal como se crea y firma en el dispositivo. */
export interface AttendanceEventPayload {
  id: string; // UUID v4 generado en el dispositivo
  deviceId: string;
  storeId: string;
  employeeId: string;
  eventType: EventType;
  deviceSeq: number; // contador estrictamente creciente por dispositivo
  occurredAt: string; // ISO-8601 con la hora de pared del dispositivo
  tzOffsetMin: number; // desfase de zona horaria del dispositivo en minutos
  monotonicMs: number | null; // reloj monotónico desde arranque, si disponible
  bootId: string | null; // identificador del arranque actual (para invalidar la referencia monotónica)
  lastServerTime: string | null; // última hora de servidor conocida
  estClockOffsetMs: number | null; // estimación (hora servidor - hora dispositivo)
  clockFlags: ClockFlag[];
  decisionFlags: DecisionFlag[];
  capturedOffline: boolean;
  matchScore: number | null;
  matchMargin: number | null;
  padScore: number | null;
  recognitionModel: string | null; // "nombre@versión"
  padModel: string | null;
  policyVersion: number;
  appVersion: string;
}

export interface SignedAttendanceEvent extends AttendanceEventPayload {
  signature: string; // base64url Ed25519 sobre la serialización canónica del payload
}

export interface LastEventRef {
  id: string;
  eventType: EventType;
  occurredAtMs: number;
  monotonicMs: number | null;
  bootId: string | null;
}
