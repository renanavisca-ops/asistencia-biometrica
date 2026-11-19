'use client';
import { useActionState } from 'react';
import { importWeekly, type ImportState } from './weekly-actions';

export function WeeklyImport({ store, storeCode }: { store: string; storeCode: string }) {
  const [state, action, pending] = useActionState<ImportState, FormData>(importWeekly, { status: 'idle' });
  return (
    <div>
      <form action={action} className="inline">
        <input type="hidden" name="store" value={store} />
        <label>Archivo Excel de la tienda {storeCode}<input type="file" name="file" accept=".xlsx" required /></label>
        <button disabled={pending}>{pending ? 'Importando…' : 'Subir horario'}</button>
      </form>
      {state.status === 'ok' && <div className="msg ok" style={{ marginTop: 8 }}>{state.message}</div>}
      {state.status === 'error' && (
        <div className="msg error" style={{ marginTop: 8 }}>{state.message}
          {!!state.errors?.length && <ul style={{ margin: '6px 0 0' }}>{state.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}
