import 'server-only';
import { redirect } from 'next/navigation';
import { humanError } from './context';

/** Vuelve a la página con mensaje de éxito o error, conservando la organización seleccionada. */
export function back(path: string, fd: FormData, error: { message?: string; code?: string } | null, ok: string, extra: Record<string, string> = {}): never {
  const p = new URLSearchParams();
  const org = fd.get('org');
  if (typeof org === 'string' && org) p.set('org', org);
  if (error) p.set('error', humanError(error)); else p.set('ok', ok);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  redirect(`${path}?${p.toString()}`);
}

export const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
};
