import type { DevicePolicy, RosterEntry } from '@asistencia/core';
import type { Identification } from '../../domain/kiosk.ts';

/**
 * Motor biométrico intercambiable. La implementación real (Fase 4) detectará el rostro, evaluará calidad y prueba de vida
 * y comparará 1:N contra el roster de la tienda — todo en el teléfono, sin red.
 */
export interface BiometricEngine {
  readonly kind: 'simulated' | 'native';
  readonly label: string;
  /** El motor simulado no identifica: requiere selección manual de prueba (ver SimulatedPicker). */
  readonly requiresManualSelection: boolean;
  identify?(roster: RosterEntry[], policy: DevicePolicy, signal: AbortSignal): Promise<
    { kind: 'match'; id: Identification } | { kind: 'no_match' | 'no_face' | 'multiple_faces' | 'low_quality' | 'liveness_failed' | 'uncalibrated' }
  >;
}

/**
 * MOTOR SIMULADO — SIN BIOMETRÍA. Solo para probar activación, almacenamiento offline, marcación y sincronización.
 * Los eventos quedan etiquetados con recognitionModel = 'SIMULADO@0' y sin puntuaciones, de modo que el servidor
 * y las exportaciones los distinguen. NO USAR EN PRODUCCIÓN.
 */
export const simulatedEngine: BiometricEngine = { kind: 'simulated', label: 'SIMULADO@0', requiresManualSelection: true };

export const simulatedIdentification = (employeeId: string): Identification => ({
  employeeId, matchScore: null, matchMargin: null, padScore: null, recognitionModel: 'SIMULADO@0', padModel: null,
});
