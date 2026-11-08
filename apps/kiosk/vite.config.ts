import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const nm = (p: string) => fileURLToPath(new URL(`./node_modules/${p}`, import.meta.url));

// ONNX Runtime referencia su .wasm desde el paquete y Vite lo emite; la app usa la copia verificada de public/vendor/ort,
// así que se descarta la emitida (14 MB) para no duplicar peso en el APK.
const dropOrtWasm = {
  name: 'drop-ort-wasm',
  generateBundle(_: unknown, bundle: Record<string, unknown>) {
    for (const k of Object.keys(bundle)) if (/ort-wasm.*\.wasm$/.test(k)) delete bundle[k];
  },
};

export default defineConfig({
  plugins: [react(), dropOrtWasm],
  base: './',
  build: {
    outDir: process.env.BIOTEST ? 'dist-biotest' : 'dist', sourcemap: false, target: 'es2022',
    // La página de prueba del motor solo se incluye en compilaciones de prueba (BIOTEST=1), nunca en el APK.
    rollupOptions: process.env.BIOTEST ? { input: { index: 'index.html', biotest: 'biotest.html' } } : undefined,
  },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  // Las pruebas e2e importan la Edge Function real; sus dependencias se resuelven desde este paquete.
  resolve: { alias: { '@noble/curves': nm('@noble/curves'), '@noble/hashes': nm('@noble/hashes'), postgres: nm('postgres') } },
  // Solo desarrollo local: DEV_API_PROXY=http://127.0.0.1:8787 + VITE_DEVICE_API_URL=/device-api
  preview: process.env.DEV_API_PROXY ? { proxy: { '/device-api': process.env.DEV_API_PROXY } } : undefined,
  test: { testTimeout: 30000 },
} as never);
