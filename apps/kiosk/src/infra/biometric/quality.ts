import type { DetectedFace, QualityIssue, QualityReport } from './types.ts';

export interface QualityPolicy { minInterocularPx: number; minBrightness: number; maxBrightness: number; minSharpness: number; maxYawDev: number; pitchRange: [number, number]; maxRollDeg: number }
export const DEFAULT_QUALITY: QualityPolicy = {
  minInterocularPx: 40, minBrightness: 55, maxBrightness: 210, minSharpness: 25, maxYawDev: 0.16, pitchRange: [0.3, 0.8], maxRollDeg: 25,
};

/** Luminancia media y varianza del laplaciano (nitidez) sobre la cara alineada 112×112. */
export function imageStats(rgba: Uint8ClampedArray, w: number, h: number) {
  const g = new Float32Array(w * h);
  let sum = 0;
  for (let i = 0; i < w * h; i++) { const y = 0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!; g[i] = y; sum += y; }
  let lsum = 0, lsq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const l = g[i - w]! + g[i + w]! + g[i - 1]! + g[i + 1]! - 4 * g[i]!;
    lsum += l; lsq += l * l; n++;
  }
  const mean = lsum / n;
  return { brightness: sum / (w * h), sharpness: lsq / n - mean * mean };
}

/** Geometría a partir de los 5 puntos: desviación de giro, inclinación y rotación. */
export function poseFromFive(f: DetectedFace) {
  const [le, re, nose, ml, mr] = f.five;
  const eyeDx = re.x - le.x, eyeDy = re.y - le.y;
  const interocular = Math.hypot(eyeDx, eyeDy);
  const yawRatio = ((nose.x - le.x) * eyeDx + (nose.y - le.y) * eyeDy) / (interocular * interocular); // 0.5 = de frente
  const eyeMid = { x: (le.x + re.x) / 2, y: (le.y + re.y) / 2 }, mouthMid = { x: (ml.x + mr.x) / 2, y: (ml.y + mr.y) / 2 };
  const vertical = Math.hypot(mouthMid.x - eyeMid.x, mouthMid.y - eyeMid.y) || 1;
  const pitchRatio = Math.hypot(nose.x - eyeMid.x, nose.y - eyeMid.y) / vertical;
  const rollDeg = (Math.atan2(eyeDy, eyeDx) * 180) / Math.PI;
  return { interocular, yawRatio, pitchRatio, rollDeg };
}

export function assessQuality(faces: DetectedFace[], stats: { brightness: number; sharpness: number } | null, p: QualityPolicy = DEFAULT_QUALITY): QualityReport {
  const issues: QualityIssue[] = [];
  const zero = { interocularPx: 0, brightness: 0, sharpness: 0, yawRatio: 0, pitchRatio: 0, rollDeg: 0 };
  if (faces.length === 0) return { ok: false, issues: ['no_face'], metrics: zero };
  if (faces.length > 1) return { ok: false, issues: ['multiple_faces'], metrics: zero };
  const pose = poseFromFive(faces[0]!);
  const m = { interocularPx: pose.interocular, brightness: stats?.brightness ?? 0, sharpness: stats?.sharpness ?? 0, yawRatio: pose.yawRatio, pitchRatio: pose.pitchRatio, rollDeg: pose.rollDeg };
  if (m.interocularPx < p.minInterocularPx) issues.push('too_small');
  if (Math.abs(m.yawRatio - 0.5) > p.maxYawDev || m.pitchRatio < p.pitchRange[0] || m.pitchRatio > p.pitchRange[1] || Math.abs(m.rollDeg) > p.maxRollDeg) issues.push('not_frontal');
  if (stats) {
    if (m.brightness < p.minBrightness) issues.push('too_dark');
    if (m.brightness > p.maxBrightness) issues.push('too_bright');
    if (m.sharpness < p.minSharpness) issues.push('blurry');
  }
  return { ok: issues.length === 0, issues, metrics: m };
}

export const QUALITY_MESSAGE: Record<QualityIssue, string> = {
  no_face: 'Mire a la cámara', multiple_faces: 'Solo una persona frente a la cámara', too_small: 'Acérquese un poco',
  too_dark: 'Necesita más luz', too_bright: 'Demasiada luz o reflejo', blurry: 'Quédese quieto un momento', not_frontal: 'Mire de frente a la cámara',
};
