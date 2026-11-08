// Alfabeto de los códigos de activación (sin O, 0, I, 1, L para evitar confusiones).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function normalizeCode(raw: string) {
  return raw.toUpperCase().split('').filter((c) => CODE_ALPHABET.includes(c)).join('').slice(0, 12);
}
export const formatCode = (n: string) => n.replace(/(.{4})(?=.)/g, '$1-');

