'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

/** Segundo factor obligatorio (TOTP). Sin aal2, RLS no devuelve ningún dato. */
export default function Mfa() {
  const router = useRouter();
  const sb = supabaseBrowser();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await sb.auth.mfa.listFactors();
      if (error) return setError(error.message);
      const verified = data.totp.find((f) => f.status === 'verified');
      if (verified) return setFactorId(verified.id);
      // Limpiar factores sin verificar de intentos anteriores y crear uno nuevo.
      for (const f of data.all.filter((f) => f.status !== 'verified')) await sb.auth.mfa.unenroll({ factorId: f.id });
      const en = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Panel ${new Date().toISOString().slice(0, 10)}` });
      if (en.error) return setError(en.error.message);
      setFactorId(en.data.id); setQr(en.data.totp.qr_code); setSecret(en.data.totp.secret);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function verify(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!factorId) return;
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    if (error) return setError('Código incorrecto o caducado.');
    router.replace('/'); router.refresh();
  }

  return (
    <main style={{ maxWidth: 420, margin: '8vh auto' }}>
      <div className="card">
        <h2>Verificación en dos pasos</h2>
        {qr ? (
          <>
            <p>Escanee este código con una app de autenticación (Google Authenticator, Microsoft Authenticator, 1Password…).</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="Código QR TOTP" width={180} height={180} />
            <p className="muted">Clave manual: <span className="mono">{secret}</span></p>
          </>
        ) : (
          <p>Introduzca el código de 6 dígitos de su app de autenticación.</p>
        )}
        {error && <div className="msg error">{error}</div>}
        <form onSubmit={verify} className="inline">
          <label>Código<input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} /></label>
          <button disabled={!factorId}>Verificar</button>
          <button type="button" className="secondary" onClick={async () => { await sb.auth.signOut(); router.replace('/login'); }}>Salir</button>
        </form>
      </div>
    </main>
  );
}
