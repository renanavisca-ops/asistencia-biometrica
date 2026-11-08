/**
 * Contratos del motor biométrico (ver docs/ARQUITECTURA_BIOMETRICA.md).
 * A. Detección/calidad · B. Reconocimiento · C. Prueba de vida · D. Plantillas (TS) · E. Asistencia (core).
 * La lógica de asistencia NO conoce el motor: solo recibe Identification.
 */
export type Point = { x: number; y: number };
export type FrameSource = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;

export interface DetectedFace {
  box: { x: number; y: number; width: number; height: number };
  /** 5 puntos en píxeles: ojo izquierdo (de la imagen), ojo derecho, nariz, boca izq., boca der. */
  five: [Point, Point, Point, Point, Point];
  /** Coeficientes de parpadeo 0..1 (para el desafío activo de prueba de vida). */
  blink: { left: number; right: number } | null;
}

export type QualityIssue = 'no_face' | 'multiple_faces' | 'too_small' | 'too_dark' | 'too_bright' | 'blurry' | 'not_frontal';
export interface QualityReport { ok: boolean; issues: QualityIssue[]; metrics: { interocularPx: number; brightness: number; sharpness: number; yawRatio: number; pitchRatio: number; rollDeg: number } }

export interface FrameAnalysis { faces: DetectedFace[]; quality: QualityReport; aligned: HTMLCanvasElement | null; ms: number }

/** A. Detección facial. */
export interface FaceDetector {
  readonly id: string; // p. ej. "mediapipe-face-landmarker@float16-1"
  init(): Promise<void>;
  detect(src: FrameSource, timestampMs?: number): Promise<DetectedFace[]>;
}

/** B. Reconocimiento: imagen alineada 112×112 → embedding L2-normalizado. */
export interface FaceRecognizer {
  readonly modelVersion: string; // debe coincidir con model_versions (nombre@versión) en el servidor
  readonly dims: number;
  init(): Promise<void>;
  embed(aligned: HTMLCanvasElement): Promise<Float32Array>;
}

/** C. Prueba de vida. Etapa 2. */
export interface LivenessDetector {
  readonly id: string;
  readonly experimental: boolean;
  init(): Promise<void>;
}

export class EngineNotIntegratedError extends Error {
  constructor(name: string) { super(`${name}: motor comercial no integrado (interfaz preparada, sin proveedor contratado)`); }
}
