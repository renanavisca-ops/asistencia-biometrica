'use client';
import { useActionState } from 'react';
import { revealDocument } from '../actions';

export function RevealDocument({ employeeId }: { employeeId: string }) {
  const [state, action, pending] = useActionState(revealDocument, null);
  if (state && 'value' in state) {
    return <p>Número completo: <span className="mono" style={{ fontSize: 16 }}>{state.value ?? '—'}</span> <span className="muted">(consulta auditada)</span></p>;
  }
  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={employeeId} />
      <label>Motivo de la consulta<input name="reason" required minLength={10} placeholder="p. ej. verificación de planilla" style={{ minWidth: 260 }} /></label>
      <button className="secondary" disabled={pending}>Ver número completo</button>
      {state?.error && <span className="msg error">{state.error}</span>}
    </form>
  );
}
