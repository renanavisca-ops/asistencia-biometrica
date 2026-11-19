'use server';
import { supabaseServer } from './supabase/server';

/** Registra en la auditoría de la organización el ingreso por soporte (el servidor limita a uno cada 30 minutos). */
export async function recordSupportView(org: string, path: string) {
  const sb = await supabaseServer();
  await sb.rpc('record_support_view', { p_org: org, p_path: path });
}
