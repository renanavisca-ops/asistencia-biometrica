'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const allowSignup = process.env.NEXT_PUBLIC_ALLOW_SIGNUP === 'true';
  // Si el enlace de invitación cae aquí (dirección de retorno no permitida en Supabase), se reenvía a la página de aceptación.
  useEffect(() => {
    if (/(^|&)type=(invite|recovery)(&|$)/.test(location.hash.slice(1)) || /access_token=/.test(location.hash)) location.replace('/auth/accept' + location.hash);
  }, []);

  async function signIn(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setMsg({ kind: 'error', text: 'Credenciales inválidas o cuenta no confirmada.' });
    // Registro hecho en la app: al primer inicio de sesión (correo ya confirmado) se crea la organización.
    const { error: sErr } = await supabaseBrowser().rpc('complete_signup');
    if (sErr) return setMsg({ kind: 'error', text: sErr.message });
    router.replace('/mfa'); router.refresh();
  }
  async function signUp() {
    if (password.length < 12) return setMsg({ kind: 'error', text: 'La contraseña debe tener al menos 12 caracteres.' });
    setBusy(true); setMsg(null);
    const { error } = await supabaseBrowser().auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}/login` } });
    setBusy(false);
    setMsg(error ? { kind: 'error', text: error.message } : { kind: 'ok', text: 'Cuenta creada. Confirme el correo y espere a que un superadministrador le asigne un rol.' });
  }

  return (
    <main style={{ maxWidth: 380, margin: '10vh auto' }}>
      <div className="card">
        <h2>Panel central de asistencia</h2>
        <p className="muted">Acceso exclusivo para administradores autorizados.</p>
        {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}
        <form onSubmit={signIn} style={{ display: 'grid', gap: 10 }}>
          <label>Correo<input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Contraseña<input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <button disabled={busy}>Entrar</button>
          {allowSignup && <button type="button" className="secondary" disabled={busy} onClick={signUp}>Crear cuenta (arranque inicial)</button>}
        </form>
      </div>
      <p className="muted" style={{ fontSize: 13, textAlign: 'center' }}>¿Empresa nueva? Regístrela desde la app del teléfono («Crear mi organización»). · <a href="/terminos">Términos y condiciones</a></p>
    </main>
  );
}
