import { describe, expect, it } from 'vitest';
import { projectSessions, type ProjectableEvent } from '../src/index.ts';

const ev = (id: string, eventType: 'IN' | 'OUT', h: number, storeId = 's1'): ProjectableEvent => ({
  id, employeeId: 'emp', storeId, eventType, occurredAtMs: h * 3_600_000,
});

describe('projectSessions', () => {
  it('empareja entrada/salida y calcula permanencia', () => {
    const s = projectSessions([ev('a', 'IN', 8), ev('b', 'OUT', 16)]);
    expect(s).toEqual([expect.objectContaining({ state: 'closed', durationMs: 8 * 3_600_000, inEventId: 'a', outEventId: 'b' })]);
  });
  it('ENTRADA seguida de ENTRADA → salida omitida', () => {
    const s = projectSessions([ev('a', 'IN', 8), ev('b', 'IN', 32), ev('c', 'OUT', 40)]);
    expect(s.map((x) => x.state)).toEqual(['missing_out', 'closed']);
  });
  it('SALIDA sin ENTRADA → huérfana', () => {
    expect(projectSessions([ev('a', 'OUT', 8)])[0]!.state).toBe('orphan_out');
  });
  it('ordena eventos que llegan desordenados (sincronización offline)', () => {
    const s = projectSessions([ev('b', 'OUT', 16), ev('a', 'IN', 8)]);
    expect(s[0]!.state).toBe('closed');
  });
  it('detecta cambio de sede entre entrada y salida', () => {
    expect(projectSessions([ev('a', 'IN', 8, 's1'), ev('b', 'OUT', 16, 's2')])[0]!.crossStore).toBe(true);
  });
  it('sesión abierta al final', () => {
    expect(projectSessions([ev('a', 'IN', 8)])[0]!.state).toBe('open');
  });
});
