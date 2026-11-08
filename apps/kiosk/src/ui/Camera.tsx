import { useEffect, useRef, useState } from 'react';

/** Vista previa de la cámara frontal. Se apaga al desmontar (no queda encendida tras la marcación). */
export function Camera() {
  const ref = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 } }, audio: false })
      .then((s) => { if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; } stream = s; if (ref.current) ref.current.srcObject = s; })
      .catch(() => setError('No se pudo abrir la cámara. Avise al encargado.'));
    return () => { cancelled = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, []);
  return (
    <div className="camera" aria-label="Vista de la cámara">
      {error ? <div className="screen muted" style={{ fontSize: 16 }}>{error}</div> : <video ref={ref} autoPlay playsInline muted />}
    </div>
  );
}
