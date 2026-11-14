'use client';
import { useActionState } from 'react';
import { issueCode } from './actions';

export function IssueCode({ deviceId, label, status }: { deviceId: string; label: string; status?: string }) {
  const [state, action, pending] = useActionState(issueCode, null);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={deviceId} />
      {state?.code ? (
        <div>
          <div className="code-once">{state.code}</div>
          <div className="muted">Válido 30 min, un solo uso. Introdúzcalo en la app de “{label}”. No se volverá a mostrar.</div>
        </div>
      ) : (
        <>
          <button className="secondary" disabled={pending}
            onClick={(e) => { if (status === 'active' && !confirm(`«${label}» ya está activo. Un código nuevo sirve para reinstalar o reemplazar ese teléfono. ¿Emitir código?`)) e.preventDefault(); }}>
            {status === 'blocked' ? 'Reactivar (emitir código)' : status === 'active' ? 'Código para reinstalar' : 'Emitir código de activación'}</button>
          {state?.error && <div className="msg error">{state.error}</div>}
        </>
      )}
    </form>
  );
}
