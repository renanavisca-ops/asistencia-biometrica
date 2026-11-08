// Descarga los modelos biométricos y copia los runtimes WASM a apps/kiosk/public. Verifica SHA-256 fijos:
// si un archivo cambia en origen, la compilación falla (evita sustituciones silenciosas del modelo).
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const kiosk = join(root, 'apps/kiosk');
const out = join(kiosk, 'public/models');
mkdirSync(out, { recursive: true });

export const MODELS = [
  {
    file: 'face_landmarker.task', // MediaPipe Face Landmarker (BlazeFace + Face Mesh v2 + blendshapes), Apache-2.0
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
  },
  {
    file: 'sface_2021dec.onnx', // OpenCV Zoo SFace (MobileFaceNet), pesos Apache-2.0 — EXPERIMENTAL: procedencia de datos no verificada
    url: 'https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx',
    sha256: '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79',
  },
];

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

// Modelos versionados en el repositorio (convertidos por nosotros; ver apps/kiosk/models-src/README.md).
const LOCAL = [
  { file: 'minifasnet_v2_2.7.onnx', sha256: 'fbac1f5cfa6d2072099fb5d575ac0635eb48b8591dfbcf0835247faaf1602c87' },
  { file: 'minifasnet_v1se_4.0.onnx', sha256: '4830dae96b69050bb513d5f4ee48cb1bbb4a3809fe169effddd19dbd28eeb1fb' },
];
for (const m of LOCAL) {
  const buf = readFileSync(join(kiosk, 'models-src', m.file));
  if (sha(buf) !== m.sha256) throw new Error(`SHA-256 inesperado para ${m.file}`);
  writeFileSync(join(out, m.file), buf);
}

for (const m of MODELS) {
  const dest = join(out, m.file);
  if (existsSync(dest) && sha(readFileSync(dest)) === m.sha256) continue;
  const res = await fetch(m.url);
  if (!res.ok) throw new Error(`No se pudo descargar ${m.file}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha(buf);
  if (got !== m.sha256) throw new Error(`SHA-256 inesperado para ${m.file}: ${got}`);
  writeFileSync(dest, buf);
  console.log(`modelo ${m.file} (${(buf.length / 1e6).toFixed(1)} MB) verificado`);
}

// Runtimes WASM empaquetados localmente (sin CDN: la app funciona sin internet).
const nm = (p) => join(kiosk, 'node_modules', p);
const mp = join(kiosk, 'public/vendor/mediapipe');
mkdirSync(mp, { recursive: true });
for (const f of readdirSync(nm('@mediapipe/tasks-vision/wasm'))) {
  // Solo el cargador clásico (SIMD y respaldo sin SIMD); la variante "module" no se usa.
  if (/^vision_wasm_(nosimd_)?internal\.(js|wasm)$/.test(f)) cpSync(join(nm('@mediapipe/tasks-vision/wasm'), f), join(mp, f));
}
const ort = join(kiosk, 'public/vendor/ort');
mkdirSync(ort, { recursive: true });
for (const f of readdirSync(nm('onnxruntime-web/dist'))) {
  if (/^ort-wasm-simd-threaded\.(wasm|mjs)$/.test(f)) cpSync(join(nm('onnxruntime-web/dist'), f), join(ort, f));
}
console.log('modelos y runtimes listos en apps/kiosk/public');
