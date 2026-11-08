// Edge Function: API de dispositivos de tienda (verify_jwt = false; autenticación por firma Ed25519).
import { createDb } from './db.ts';
import { createHandler } from './handler.ts';

const url = Deno.env.get('SUPABASE_DB_URL');
if (!url) throw new Error('SUPABASE_DB_URL no disponible');
const handler = createHandler(createDb(url), (m, e) => console.error(m, JSON.stringify(e)));
Deno.serve(handler);
