'use client';
import { useActionState, useState } from 'react';
import { invite, type InviteState } from './actions';

/** Invitar administrador: genera un enlace de un solo uso para compartir (WhatsApp o correo). */
export function InviteForm({ orgs, defaultOrg, isSuper }: { orgs: { id: string; name: string }[]; defaultOrg: string; isSuper: boolean }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(invite, { status: 'idle' });
  const [copied, setCopied] = useState(false);
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3>Invitar administrador</h3>
      <p className="muted">La persona recibe un enlace para crear su contraseña; al entrar deberá configurar su autenticador (verificación en 2 pasos). Un administrador central ve y gestiona solo su organización.</p>
      <form action={action} className="inline">
        <input type="hidden" name="org" value={defaultOrg} />
        <label>Nombre<input name="name" required minLength={2} placeholder="Nombre y apellido" /></label>
        <label>Correo<input name="email" type="email" required autoComplete="off" /></label>
        <label>Rol<select name="role" defaultValue="central_admin">
          <option value="central_admin">Administrador central</option>
          {isSuper && <option value="superadmin">Superadministrador (toda la plataforma)</option>}
        </select></label>
        <label>Organización<select name="invite_org" defaultValue={defaultOrg}>
          {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select></label>
        <button disabled={pending}>{pending ? 'Creando…' : 'Crear invitación'}</button>
      </form>
      {state.status === 'error' && <div className="msg error" style={{ marginTop: 10 }}>{state.message}</div>}
      {state.status === 'ok' && (
        <div className="msg ok" style={{ marginTop: 10 }}>
          <div>{state.message}</div>
          {state.link && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input readOnly value={state.link} style={{ flex: 1, minWidth: 240 }} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className="secondary" onClick={async () => { await navigator.clipboard.writeText(state.link!); setCopied(true); }}>{copied ? 'Copiado ✓' : 'Copiar enlace'}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
