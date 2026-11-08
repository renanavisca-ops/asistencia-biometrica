// Prueba del motor biométrico gratuito REAL (MediaPipe + SFace en WebAssembly) en Chromium, igual que en la WebView.
// Imágenes: muestras públicas de OpenCV (samples/data). NO mide precisión: verifica que la cadena funciona y es coherente.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { build, preview } from 'vite';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
// Imágenes públicas de prueba: mediapipe-assets (proyecto MediaPipe, Apache-2.0) y OpenCV samples/data.
const IMGS = {
  'a.jpg': ['https://storage.googleapis.com/mediapipe-assets/portrait.jpg'], // retrato frontal (hombre)
  'b.jpg': ['https://storage.googleapis.com/mediapipe-assets/business-person.png'], // retrato frontal (mujer)
  'c.jpg': ['https://raw.githubusercontent.com/opencv/opencv/4.x/samples/data/lena.jpg'], // rostro girado → debe rechazarse por calidad
};
const cache = {};
for (const [k, [u]] of Object.entries(IMGS)) { const r = await fetch(u); if (!r.ok) throw new Error(`${u} ${r.status}`); cache[k] = Buffer.from(await r.arrayBuffer()); }

process.env.BIOTEST = '1';
const kroot = join(root, 'apps/kiosk');
await build({ root: kroot, logLevel: 'error' });
const server = await preview({ root: kroot, preview: { port: 5199, strictPort: true }, build: { outDir: 'dist-biotest' }, logLevel: 'error' });
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.route('**/__biotest__/*', (route) => { const f = route.request().url().split('/').pop(); route.fulfill({ body: cache[f], contentType: f.endsWith('png') ? 'image/png' : 'image/jpeg' }); });
await page.goto('http://127.0.0.1:5199/biotest.html');
const result = await page.waitForFunction(() => window.__result, null, { timeout: 180000 }).then((h) => h.jsonValue());
await browser.close(); await new Promise((r) => server.httpServer.close(r));
console.log(JSON.stringify(result, null, 1));

// Comprobaciones mínimas de coherencia (no son métricas de precisión).
const fail = [];
if (result.error) fail.push('error: ' + result.error);
if (result.dims !== 128) fail.push('dimensión de embedding != 128');
if (Math.abs(result.norm - 1) > 1e-3) fail.push('embedding no normalizado');
const same = Object.values(result.similarity?.misma_persona ?? {}).filter((x) => x != null);
const diff = Object.values(result.similarity?.distinta_persona ?? {}).filter((x) => x != null);
if (!same.length || !diff.length) fail.push('faltan embeddings');
if (Math.min(...same) <= Math.max(...diff)) fail.push(`no separa: min misma=${Math.min(...same)} max distinta=${Math.max(...diff)}`);
if (result.report?.blank?.issues?.[0] !== 'no_face') fail.push('imagen vacía no detectada como sin rostro');
if (result.report?.two_people?.issues?.[0] !== 'multiple_faces') fail.push('dos personas no detectadas');
if (!result.report?.c?.quality?.issues?.includes('not_frontal')) fail.push('rostro girado no rechazado');
if (!result.report?.a?.quality?.ok || !result.report?.b?.quality?.ok) fail.push('retratos frontales no aceptados por calidad');
if (fail.length) { console.error('FALLO:\n' + fail.join('\n')); process.exit(1); }
console.log('OK motor biométrico: separa misma/distinta persona en las muestras y detecta casos de calidad');
