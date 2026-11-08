'use client';
import { useActionState } from 'react';
import { issueCode } from './actions';

export function IssueCode({ deviceId, label }: { deviceId: string; label: string }) {
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
          <button className="secondary" disabled={pending}>Emitir código de activación</button>
          {state?.error && <div className="msg error">{state.error}</div>}
        </>
      )}
    </form>
  );
}
