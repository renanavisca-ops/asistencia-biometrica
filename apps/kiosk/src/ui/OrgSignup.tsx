import { useRef, useState } from 'react';
import { PANEL_URL, TERMS, TERMS_VERSION } from '@asistencia/core';
import { createAdminClient } from '../infra/adminSession.ts';

const COUNTRIES: [string, string][] = [['GT', 'Guatemala'], ['SV', 'El Salvador'], ['HN', 'Honduras'], ['NI', 'Nicaragua'], ['CR', 'Costa Rica'], ['PA', 'Panamá'], ['BZ', 'Belice']];

/**
 * Registro de una organización nueva desde la app (no hay página web pública).
 * Crea la cuenta del administrador con los datos de la organización; al confirmar el correo y entrar al panel,
 * el servidor crea la organización (complete_signup). Campos NO controlados (teclado de Android).
 */
export function OrgSignup({ onBack }: { onBack: () => void }) {
  const sb = useRef(createAdminClient());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [showTerms, setShowTerms] = useState(false);

  if (sent) {
    return (
      <div className="screen" style={{ textAlign: 'center', gap: 12, padding: 20 }}>
        <h1>Revise su correo</h1>
        <p style={{ fontSize: 18 }}>Enviamos un enlace de confirmación a <b>{sent}</b>.</p>
        <ol style={{ textAlign: 'left', fontSize: 16, maxWidth: 460 }}>
          <li>Abra el correo y confirme su cuenta.</li>
          <li>Entre al panel web <b>{PANEL_URL.replace('https://', '')}</b> con su correo y contraseña y configure su autenticador (verificación en 2 pasos).</li>
          <li>En el panel cree su sede central, sus tiendas, sus empleados y registre este teléfono para obtener el código de activación.</li>
          <li>Vuelva aquí y escriba el código para activar el teléfono.</li>
        </ol>
        <button className="btn primary" onClick={onBack}>Ya tengo el código de activación</button>
      </div>
    );
  }

  return (
    <form className="screen" style={{ justifyContent: 'flex-start', overflowY: 'auto', paddingTop: 24, gap: 10 }} onSubmit={async (e) => {
      e.preventDefault(); setErr(null);
      const fd = new FormData(e.currentTarget);
      const g = (k: string) => String(fd.get(k) ?? '').trim();
      const email = g('email').replace(/\s+/g, '').toLowerCase();
      if (g('org_name').length < 2) return setErr('Escriba el nombre de la organización.');
      if (g('admin_name').length < 2) return setErr('Escriba su nombre.');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) return setErr('Correo no válido.');
      if (g('p1').length < 12) return setErr('La contraseña debe tener al menos 12 caracteres.');
      if (g('p1') !== g('p2')) return setErr('Las contraseñas no coinciden.');
      if (fd.get('terms') !== 'on') return setErr('Debe leer y aceptar los términos y condiciones.');
      setBusy(true);
      const { error } = await sb.current.auth.signUp({
        email, password: g('p1'),
        options: {
          emailRedirectTo: `${PANEL_URL}/auth/confirmed`,
          data: { signup: { org_name: g('org_name'), country: g('country'), admin_name: g('admin_name'), terms_version: TERMS_VERSION } },
        },
      });
      setBusy(false);
      if (error) return setErr(/registered|already/i.test(error.message) ? 'Ese correo ya tiene una cuenta. Entre al panel web con él.' : 'No se pudo registrar: ' + error.message);
      setSent(email);
    }}>
      <h1 style={{ margin: 0 }}>Crear mi organización</h1>
      <p className="muted" style={{ margin: 0 }}>Gratis hasta 5 empleados. Usted quedará como administrador de su organización.</p>
      <input name="org_name" className="plain" placeholder="Nombre de la empresa u organización" autoComplete="off" />
      <select name="country" defaultValue="GT" style={{ fontSize: 18, padding: 10 }}>{COUNTRIES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <input name="admin_name" className="plain" placeholder="Su nombre y apellido" autoComplete="off" />
      <input name="email" className="plain" type="email" inputMode="email" placeholder="Su correo" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      <input name="p1" className="plain" type="password" placeholder="Contraseña (mínimo 12 caracteres)" autoComplete="new-password" />
      <input name="p2" className="plain" type="password" placeholder="Repita la contraseña" autoComplete="new-password" />
      <button type="button" className="btn small" onClick={() => setShowTerms((v) => !v)}>{showTerms ? 'Ocultar' : 'Leer'} términos y condiciones</button>
      {showTerms && (
        <div style={{ textAlign: 'left', maxHeight: 280, overflowY: 'auto', fontSize: 14, background: 'rgba(127,127,127,.12)', padding: 10, borderRadius: 8, width: 'min(520px, 92vw)' }}>
          {TERMS.map((t) => <div key={t.title}><b>{t.title}</b>{t.body.map((p, i) => <p key={i} style={{ margin: '4px 0 8px' }}>{p}</p>)}</div>)}
          <p className="muted">Versión {TERMS_VERSION}</p>
        </div>
      )}
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 15, textAlign: 'left', width: 'min(520px, 92vw)' }}>
        <input type="checkbox" name="terms" style={{ width: 24, height: 24 }} />
        Leí y acepto los términos en nombre de mi organización: los datos son de mi organización, me comprometo a cuidarlos como lo exige la ley, la plataforma no conserva registros por plazos legales y debo descargar mis datos.
      </label>
      {err && <p style={{ color: 'var(--err)', margin: 0 }}>{err}</p>}
      <button className="btn primary" disabled={busy}>{busy ? 'Registrando…' : 'Crear organización'}</button>
      <button type="button" className="btn small" onClick={onBack}>Volver</button>
    </form>
  );
}
