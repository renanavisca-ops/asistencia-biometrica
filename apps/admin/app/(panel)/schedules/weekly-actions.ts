'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { humanError } from '@/lib/context';
import { parseWeekly, toRpcRows } from '@/lib/weekly';

export type ImportState = { status: 'idle' | 'ok' | 'error'; message?: string; errors?: string[]; week?: string };

/** Importa el Excel del horario semanal de una sucursal (reemplaza lo importado antes para esa semana). */
export async function importWeekly(_prev: ImportState, fd: FormData): Promise<ImportState> {
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) return { status: 'error', message: 'Seleccione el archivo Excel.' };
  if (file.size > 2 * 1024 * 1024) return { status: 'error', message: 'El archivo supera 2 MB.' };
  const parsed = await parseWeekly(await file.arrayBuffer());
  if (!parsed.ok) return { status: 'error', message: 'El archivo tiene errores; corríjalos y vuelva a subirlo.', errors: parsed.errors };
  const sb = await supabaseServer();
  const storeId = String(fd.get('store') ?? '');
  const { data: st } = await sb.from('stores').select('code').eq('id', storeId).maybeSingle();
  if (!st) return { status: 'error', message: 'Sucursal no encontrada.' };
  if (st.code !== parsed.sheet.storeCode) return { status: 'error', message: `El archivo es de la tienda ${parsed.sheet.storeCode}, pero está importando en ${st.code}.` };
  const { data, error } = await sb.rpc('import_weekly_schedule', { p_store: storeId, p_week_start: parsed.sheet.weekStart, p_tolerance: parsed.sheet.tolerance, p_rows: toRpcRows(parsed.sheet) });
  if (error) return { status: 'error', message: humanError(error) };
  revalidatePath('/schedules');
  const r = data as { employees: number; schedules: number };
  return { status: 'ok', week: parsed.sheet.weekStart,
    message: `Horario de la semana del ${parsed.sheet.weekStart} importado: ${r.employees} empleados. Las tardanzas de esa semana se recalcularon.` };
}
