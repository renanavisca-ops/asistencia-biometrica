import { useEffect, useRef, useState } from 'react';

/** Vista previa de la cámara frontal. Se apaga al desmontar (no queda encendida tras la marcación). */
export function Camera({ onVideo }: { onVideo?: (v: HTMLVideoElement | null) => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 } }, audio: false })
      .then((s) => {
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        if (ref.current) { ref.current.srcObject = s; ref.current.onloadeddata = () => onVideo?.(ref.current); }
      })
      .catch(() => setError('No se pudo abrir la cámara. Avise al encargado.'));
    return () => { cancelled = true; onVideo?.(null); stream?.getTracks().forEach((t) => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="camera" aria-label="Vista de la cámara">
      {error ? <div className="screen muted" style={{ fontSize: 16 }}>{error}</div> : <video ref={ref} autoPlay playsInline muted />}
    </div>
  );
}
