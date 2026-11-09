'use client';
import { useEffect, useState } from 'react';

/** Destino del enlace de confirmación de correo del registro hecho en la app. */
export default function Confirmed() {
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const h = new URLSearchParams(location.hash.slice(1));
    const e = h.get('error_description') ?? new URLSearchParams(location.search).get('error_description');
    if (e) setErr(e.replace(/\+/g, ' '));
    history.replaceState(null, '', location.pathname); // no dejar tokens en la barra de direcciones
  }, []);
  return (
    <main style={{ maxWidth: 460, margin: '10vh auto', padding: '0 16px' }}>
      <div className="card">
        {err ? (
          <><h2>No se pudo confirmar</h2><div className="msg error">{err}</div><p>El enlace puede haber vencido. Regístrese de nuevo desde la app o pida ayuda.</p></>
        ) : (
          <>
            <h2>¡Correo confirmado!</h2>
            <p>Ahora entre al panel con su correo y contraseña. La primera vez configurará su autenticador (verificación en 2 pasos) y se creará su organización.</p>
            <p>Luego cree su sede central, sus sucursales y empleados, y registre los teléfonos para obtener los códigos de activación.</p>
          </>
        )}
        <a href="/login"><button style={{ width: '100%' }}>Ir a iniciar sesión</button></a>
      </div>
    </main>
  );
}
