/** Servicios de plataforma inyectables (nativos en el teléfono, simulados en pruebas). */
export interface Platform {
  nowMs(): number;
  /** Reloj monotónico desde el arranque del sistema (Android: SystemClock.elapsedRealtime). */
  monotonicMs(): Promise<number | null>;
  /** Identificador del arranque actual (Android: Settings.Global.BOOT_COUNT). */
  bootId(): Promise<string | null>;
  tzOffsetMin(): number;
  uuid(): string;
  appVersion: string;
  deviceInfo(): Promise<{ platform: 'android' | 'ios'; osVersion: string; model: string; batteryPct: number | null }>;
}
