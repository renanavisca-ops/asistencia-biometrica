import { describe, expect, it } from 'vitest';
import { formatCode, normalizeCode } from '../src/ui/App.tsx';

describe('código de activación', () => {
  it('normaliza mayúsculas, guiones y espacios', () => {
    expect(normalizeCode(' 236r-65qc g8rq ')).toBe('236R65QCG8RQ');
    expect(formatCode('236R65QCG8RQ')).toBe('236R-65QC-G8RQ');
  });
  it('descarta caracteres que nunca aparecen (O, 0, I, 1, L) y limita a 12', () => {
    expect(normalizeCode('O0I1L236R65QCG8RQXX')).toBe('236R65QCG8RQ');
  });
  it('formato parcial mientras se escribe', () => {
    expect(formatCode('236R6')).toBe('236R-6');
    expect(formatCode('236R')).toBe('236R');
  });
});
