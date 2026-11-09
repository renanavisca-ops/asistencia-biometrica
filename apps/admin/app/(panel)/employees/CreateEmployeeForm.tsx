'use client';
import Link from 'next/link';
import { useActionState, useState } from 'react';
import { createEmployee, type CreateEmployeeState } from './actions';
import { COUNTRIES, DOC_TYPES } from '@/lib/documents';

type Store = { id: string; code: string; name: string; is_central: boolean };

/** Reglas visibles mientras se escribe (el servidor valida de nuevo). */
function docHint(type: string, raw: string): { ok: boolean; text: string } {
  const alnum = raw.replace(/[^A-Za-z0-9]/g, '');
  if (type === 'DPI') {
    const digits = raw.replace(/\D/g, '');
    if (/[A-Za-z]/.test(raw)) return { ok: false, text: 'El DPI solo lleva números.' };
    return { ok: digits.length === 13, text: `${digits.length} de 13 dígitos` };
  }
  if (!alnum) return { ok: false, text: '5 a 20 letras o números' };
  return { ok: alnum.length >= 5 && alnum.length <= 20, text: `${alnum.length} caracteres (5 a 20)` };
}

export function CreateEmployeeForm({ org, stores, defaultCountry }: { org: string; stores: Store[]; defaultCountry: string }) {
  const [state, action, pending] = useActionState<CreateEmployeeState, FormData>(createEmployee, { status: 'idle' });
  const v = state.values ?? {};
  // La key cambia tras cada alta correcta: el formulario se vacía (salvo tipo/país/sede) sin recargar la página.
  const formKey = state.status === 'ok' ? state.created!.id : 'form';
  return (
    <>
      {state.status === 'ok' && (
        <div className="msg ok" role="status">
          Empleado <b>{state.created!.name}</b> creado con código <b className="mono">{state.created!.code}</b>.{' '}
          <Link href={`/employees/${state.created!.id}?org=${org}`}>Ver ficha</Link>
        </div>
      )}
      {state.status === 'error' && !state.field && <div className="msg error" role="alert">{state.message}</div>}
      <Fields key={formKey} org={org} stores={stores} defaultCountry={defaultCountry} v={v} state={state} action={action} pending={pending} />
    </>
  );
}

function Fields({ org, stores, defaultCountry, v, state, action, pending }: {
  org: string; stores: Store[]; defaultCountry: string; v: Record<string, string>; state: CreateEmployeeState;
  action: (fd: FormData) => void; pending: boolean;
}) {
  const [type, setType] = useState(v.document_type || 'DPI');
  const [num, setNum] = useState(state.status === 'error' ? v.document_number ?? '' : '');
  const hint = docHint(type, num);
  const err = (f: string) => (state.status === 'error' && state.field === f ? state.message : null);
  const bad = { borderColor: 'var(--danger)', outline: 'none', boxShadow: '0 0 0 2px #fdecea' };
  const keep = (k: string) => (state.status === 'error' ? v[k] ?? '' : '');
  return (
    <form action={action} className="inline" noValidate={false}>
      <input type="hidden" name="org" value={org} />
      <label>Nombre(s)
        <input name="first_name" required defaultValue={keep('first_name')} style={err('first_name') ? bad : undefined} />
        {err('first_name') && <span style={{ color: 'var(--danger)' }}>{err('first_name')}</span>}
      </label>
      <label>Apellido(s)<input name="last_name" required defaultValue={keep('last_name')} /></label>
      <label>Género (saludo)
        <select name="gender" defaultValue={keep('gender')}>
          <option value="">No indicado</option><option value="F">Femenino</option><option value="M">Masculino</option>
        </select>
      </label>
      <label>Tipo de documento
        <select name="document_type" value={type} onChange={(e) => setType(e.target.value)}>{DOC_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </label>
      <label>País del documento
        <select name="document_country" defaultValue={v.document_country || defaultCountry}>{COUNTRIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </label>
      <label>Número de documento
        <input name="document_number" required autoComplete="off" value={num} onChange={(e) => setNum(e.target.value)}
          inputMode={type === 'DPI' ? 'numeric' : 'text'} placeholder={type === 'DPI' ? '2563 41234 0101' : ''}
          aria-invalid={!!err('document_number')} style={err('document_number') || (num && !hint.ok) ? bad : undefined} />
        <span style={{ color: err('document_number') ? 'var(--danger)' : hint.ok ? 'var(--ok)' : 'var(--muted)' }}>
          {err('document_number') ?? hint.text}
        </span>
      </label>
      <label>Fecha de ingreso<input type="date" name="hired_on" defaultValue={keep('hired_on')} /></label>
      <label>Sede asignada
        <select name="store_id" defaultValue={v.store_id ?? ''} style={err('store_id') ? bad : undefined}>
          <option value="">(asignar después)</option>
          {stores.filter((st) => !st.is_central).map((st) => <option key={st.id} value={st.id}>{st.code} · {st.name}</option>)}
          {stores.filter((st) => st.is_central).map((st) => <option key={st.id} value={st.id}>{st.code} · {st.name} (sede central)</option>)}
        </select>
        {err('store_id') && <span style={{ color: 'var(--danger)' }}>{err('store_id')}</span>}
      </label>
      <button disabled={pending || !hint.ok}>{pending ? 'Creando…' : 'Crear'}</button>
    </form>
  );
}
