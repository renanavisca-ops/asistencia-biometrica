// Copia packages/core/src a supabase/functions/_shared/core para que las Edge Functions (Deno) usen
// exactamente la misma lógica que la app y el panel. Ejecutar antes de desplegar: pnpm sync:shared
import { cpSync, rmSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'packages/core/src');
const dst = join(root, 'supabase/functions/_shared/core');
rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
writeFileSync(join(dst, 'README.md'), '# Copia generada de packages/core/src — no editar aquí (pnpm sync:shared)\n');
console.log('core sincronizado:', readdirSync(dst).join(', '));
