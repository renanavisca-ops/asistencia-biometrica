'use client';
import { useActionState, useState } from 'react';
import { createOrg, type CreateOrgState } from '../actions';

const COUNTRIES: [string, string, string][] = [['GT', 'Guatemala', 'America/Guatemala'], ['SV', 'El Salvador', 'America/El_Salvador'], ['HN', 'Honduras', 'America/Tegucigalpa'],
  ['NI', 'Nicaragua', 'America/Managua'], ['CR', 'Costa Rica', 'America/Costa_Rica'], ['PA', 'Panamá', 'America/Panama'], ['BZ', 'Belice', 'America/Belize'], ['MX', 'México', 'America/Mexico_City']];

export function CreateOrgForm() {
  const [state, action, pending] = useActionState<CreateOrgState, FormData>(createOrg, { status: 'idle' });
  const [tz, setTz] = useState('America/Guatemala');
  const [copied, setCopied] = useState(false);
  return (
    <details className="card" style={{ marginTop: 16 }} open={state.status !== 'idle'}>
      <summary><b>Crear organización cliente</b></summary>
      <form action={action} style={{ display: 'grid', gap: 10, marginTop: 10 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label>Nombre comercial<input name="name" required minLength={2} /></label>
          <label>Razón social<input name="legal_name" /></label>
          <label>NIT / identificación fiscal<input name="tax_id" /></label>
          <label>País<select name="country" defaultValue="GT" onChange={(e) => setTz(COUNTRIES.find(([k]) => k === e.target.value)?.[2] ?? tz)}>
            {COUNTRIES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Zona horaria<input name="timezone" value={tz} onChange={(e) => setTz(e.target.value)} required /></label>
          <label>Correo de contacto<input name="contact_email" type="email" /></label>
          <label>Teléfono de contacto<input name="contact_phone" /></label>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label>Máx. empleados vigentes<input name="max_employees" type="number" min={1} defaultValue={5} /></label>
          <label style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><input type="checkbox" name="unlimited" style={{ minWidth: 0 }} /> Sin límite</label>
          <label>Autorizado hasta (vencimiento)<input name="paid_until" type="date" /></label>
          <label>Máx. sucursales (vacío = sin límite)<input name="max_stores" type="number" min={1} /></label>
          <label>Máx. teléfonos (vacío = sin límite)<input name="max_devices" type="number" min={1} /></label>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label>Administrador principal: nombre<input name="admin_name" minLength={2} /></label>
          <label>Correo<input name="admin_email" type="email" autoComplete="off" /></label>
        </div>
        <p className="muted" style={{ margin: 0 }}>Usted no queda como administrador de esta organización ni ve sus datos. Si deja vacío el administrador, puede invitarlo después.</p>
        <button disabled={pending}>{pending ? 'Creando…' : 'Crear organización'}</button>
      </form>
      {state.status === 'error' && <div className="msg error" style={{ marginTop: 10 }}>{state.message}</div>}
      {state.status === 'ok' && (
        <div className="msg ok" style={{ marginTop: 10 }}>{state.message}
          {state.link && <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input readOnly value={state.link} style={{ flex: 1 }} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="secondary" onClick={async () => { await navigator.clipboard.writeText(state.link!); setCopied(true); }}>{copied ? 'Copiado ✓' : 'Copiar enlace'}</button>
          </div>}
        </div>
      )}
    </details>
  );
}
