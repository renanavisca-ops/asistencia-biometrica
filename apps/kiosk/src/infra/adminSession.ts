import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL_ = import.meta.env.VITE_SUPABASE_URL ?? 'https://grsezvfrkxzurgelyujv.supabase.co';
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'sb_publishable_LHvedPKqQ36xsf3BEBD7UA_OHyxf3Sk'; // clave pública (publishable)

/**
 * Sesión de ADMINISTRADOR para el modo enrolamiento. Solo en memoria (no se guarda en el teléfono) y se cierra al salir.
 * Todas las operaciones pasan por RLS/RPC con MFA (aal2); el teléfono no recibe privilegios propios.
 */
export function createAdminClient(): SupabaseClient {
  return createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false } });
}
