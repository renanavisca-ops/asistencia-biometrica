'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

/**
 * Aceptar invitación: el enlace de Supabase llega con la sesión en el fragmento (#access_token=…&type=invite).
 * La persona crea su contraseña y luego configura su autenticador (/mfa).
 */
export default function Accept() {
  const router = useRouter();
  const [phase, setPhase] = useState<'loading' | 'form' | 'error'>('loading');
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const h = new URLSearchParams(location.hash.slice(1));
      const err = h.get('error_description');
      if (err) { setMsg(err.replace(/\+/g, ' ')); return setPhase('error'); }
      const at = h.get('access_token'), rt = h.get('refresh_token');
      if (at && rt) {
        const { error } = await sb.auth.setSession({ access_token: at, refresh_token: rt });
        history.replaceState(null, '', location.pathname); // no dejar el token en la barra de direcciones
        if (error) { setMsg('El enlace no es válido o ya venció. Pida una nueva invitación.'); return setPhase('error'); }
      }
      const { data } = await sb.auth.getUser();
      if (!data.user) { setMsg('El enlace no es válido o ya venció. Pida una nueva invitación.'); return setPhase('error'); }
      setEmail(data.user.email ?? ''); setPhase('form');
    })();
  }, []);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setMsg(null);
    const fd = new FormData(e.currentTarget);
    const p1 = String(fd.get('p1') ?? ''), p2 = String(fd.get('p2') ?? '');
    if (p1.length < 12) return setMsg('La contraseña debe tener al menos 12 caracteres.');
    if (p1 !== p2) return setMsg('Las contraseñas no coinciden.');
    setBusy(true);
    const { error } = await supabaseBrowser().auth.updateUser({ password: p1 });
    setBusy(false);
    if (error) return setMsg(error.message);
    router.replace('/mfa'); router.refresh();
  }

  return (
    <main style={{ maxWidth: 420, margin: '8vh auto' }}>
      <div className="card">
        <h2>Bienvenido(a) al panel de asistencia</h2>
        {phase === 'loading' && <p>Validando invitación…</p>}
        {phase === 'error' && <><div className="msg error">{msg}</div><a href="/login">Ir a iniciar sesión</a></>}
        {phase === 'form' && (
          <form onSubmit={save} style={{ display: 'grid', gap: 10 }}>
            <p>Cuenta: <b>{email}</b></p>
            <p className="muted">Cree su contraseña (mínimo 12 caracteres). Después configurará su autenticador (verificación en 2 pasos), obligatorio para usar el panel.</p>
            <label>Contraseña<input name="p1" type="password" autoComplete="new-password" required minLength={12} /></label>
            <label>Repita la contraseña<input name="p2" type="password" autoComplete="new-password" required minLength={12} /></label>
            {msg && <div className="msg error">{msg}</div>}
            <button disabled={busy}>{busy ? 'Guardando…' : 'Crear contraseña y continuar'}</button>
          </form>
        )}
      </div>
    </main>
  );
}
