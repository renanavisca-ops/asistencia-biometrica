import { describe, expect, it } from 'vitest';
import { ActiveChallenge, randomChallenge } from '../src/infra/biometric/activeChallenge.ts';
import { cropBox } from '../src/infra/biometric/crop.ts';
import type { DetectedFace } from '../src/infra/biometric/types.ts';

// Cara sintética: ojos en x=100 y 200, nariz desplazable (yawRatio = (nx-100)/100).
const face = (noseX: number, blink = 0): DetectedFace => ({
  box: { x: 80, y: 60, width: 140, height: 180 },
  five: [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: noseX, y: 150 }, { x: 115, y: 200 }, { x: 185, y: 200 }],
  blink: { left: blink, right: blink },
});

describe('desafío activo', () => {
  it('parpadeo: abierto → cerrado → abierto', () => {
    const c = new ActiveChallenge('blink');
    expect(c.update(face(150, 0.05))).toBe(false);
    expect(c.update(face(150, 0.8))).toBe(false);
    expect(c.update(face(150, 0.1))).toBe(true);
  });
  it('foto estática (sin parpadeo) nunca cumple', () => {
    const c = new ActiveChallenge('blink');
    for (let i = 0; i < 50; i++) expect(c.update(face(150, 0.05))).toBe(false);
  });
  it('giro a su izquierda = nariz hacia la derecha de la imagen', () => {
    const l = new ActiveChallenge('turn_left');
    l.update(face(150)); expect(l.update(face(158))).toBe(false); expect(l.update(face(163))).toBe(true);
  });
  it('giro al lado contrario NO cumple el desafío pedido', () => {
    const r = new ActiveChallenge('turn_right');
    r.update(face(150));
    for (const x of [160, 170, 180]) expect(r.update(face(x))).toBe(false);
    expect(r.update(face(138))).toBe(true);
  });
  it('desafío aleatorio cubre los tres tipos', () => {
    expect([0, 0.4, 0.9].map(randomChallenge)).toEqual(['blink', 'turn_left', 'turn_right']);
  });
});

describe('recorte de la prueba pasiva (igual que el original)', () => {
  it('escala alrededor del centro y se mantiene dentro de la imagen', () => {
    const c = cropBox(640, 480, { x: 270, y: 150, width: 100, height: 120 }, 2.7);
    expect(c.w).toBeCloseTo(270); expect(c.h).toBeCloseTo(324);
    expect(c.l).toBeGreaterThanOrEqual(0); expect(c.t + c.h).toBeLessThanOrEqual(479);
  });
  it('limita la escala si la cara es muy grande', () => {
    const c = cropBox(640, 480, { x: 100, y: 50, width: 300, height: 400 }, 4);
    expect(c.h).toBeLessThanOrEqual(479);
  });
});
