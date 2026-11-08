import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const nm = (p: string) => fileURLToPath(new URL(`./node_modules/${p}`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', sourcemap: false, target: 'es2022' },
  // Las pruebas e2e importan la Edge Function real; sus dependencias se resuelven desde este paquete.
  resolve: { alias: { '@noble/curves': nm('@noble/curves'), '@noble/hashes': nm('@noble/hashes'), postgres: nm('postgres') } },
  // Solo desarrollo local: DEV_API_PROXY=http://127.0.0.1:8787 + VITE_DEVICE_API_URL=/device-api
  preview: process.env.DEV_API_PROXY ? { proxy: { '/device-api': process.env.DEV_API_PROXY } } : undefined,
  test: { testTimeout: 30000 },
} as never);
