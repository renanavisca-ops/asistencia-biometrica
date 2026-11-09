import { TERMS, TERMS_VERSION } from '@asistencia/core';

export const metadata = { title: 'Términos y condiciones' };

export default function Terminos() {
  return (
    <main style={{ maxWidth: 760, margin: '5vh auto', padding: '0 16px' }}>
      <div className="card">
        <h2>Términos y condiciones del servicio</h2>
        <p className="muted">Versión {TERMS_VERSION}. Borrador pendiente de revisión legal en cada país.</p>
        {TERMS.map((t) => (
          <section key={t.title}>
            <h3>{t.title}</h3>
            {t.body.map((p, i) => <p key={i}>{p}</p>)}
          </section>
        ))}
        <p><a href="/login">Volver</a></p>
      </div>
    </main>
  );
}
