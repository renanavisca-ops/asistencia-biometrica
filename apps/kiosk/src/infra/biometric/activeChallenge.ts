import { poseFromFive } from './quality.ts';
import type { DetectedFace } from './types.ts';

/**
 * C. Prueba de vida ACTIVA: desafío aleatorio (parpadeo o giro a un lado). EXPERIMENTAL.
 * Útil contra fotos impresas y pantallas estáticas; un vídeo grabado puede superarlo (por eso es aleatorio y se combina
 * con la prueba pasiva y la continuidad de identidad).
 * Geometría: en la imagen de la cámara frontal (sin espejo), si la persona gira a SU izquierda la nariz se desplaza hacia
 * la derecha de la imagen → yawRatio aumenta.
 */
export type ChallengeKind = 'blink' | 'turn_left' | 'turn_right';
export const CHALLENGE_TEXT: Record<ChallengeKind, string> = {
  blink: 'Parpadee una vez', turn_left: 'Gire un poco la cabeza a su izquierda', turn_right: 'Gire un poco la cabeza a su derecha',
};

export function randomChallenge(rand = Math.random()): ChallengeKind {
  return (['blink', 'turn_left', 'turn_right'] as const)[Math.min(2, Math.floor(rand * 3))]!;
}

export class ActiveChallenge {
  private baseline: number | null = null;
  private closedSeen = false;
  private blinks = 0;
  private peak = 0;
  constructor(readonly kind: ChallengeKind, readonly turnDelta = 0.1, readonly requiredBlinks = 1) {}

  /** Alimenta un fotograma; devuelve true cuando el desafío se ha cumplido. */
  update(face: DetectedFace): boolean {
    if (this.kind === 'blink') {
      if (!face.blink) return false;
      const b = Math.max(face.blink.left, face.blink.right);
      if (b > 0.5) this.closedSeen = true;
      else if (b < 0.25 && this.closedSeen) { this.blinks++; this.closedSeen = false; }
      return this.blinks >= this.requiredBlinks;
    }
    const yaw = poseFromFive(face).yawRatio;
    this.baseline ??= yaw;
    const d = yaw - this.baseline;
    this.peak = this.kind === 'turn_left' ? Math.max(this.peak, d) : Math.max(this.peak, -d);
    return this.peak >= this.turnDelta;
  }
}
