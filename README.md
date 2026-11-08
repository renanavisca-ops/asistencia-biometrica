# Asistencia biométrica multitienda

Control de asistencia con **un teléfono compartido por tienda**: el empleado mira la cámara y el sistema registra ENTRADA o SALIDA automáticamente, **aun sin internet**. El enrolamiento facial se hace una sola vez en la sede central y la administración es central, multiorganización y multipaís.

> ⚠️ **Reconocimiento facial y prueba de vida: NO IMPLEMENTADOS.** Ver [docs/BIOMETRICS.md](docs/BIOMETRICS.md) y [docs/STATUS.md](docs/STATUS.md).

## Estructura
```
packages/core/          Lógica compartida (TS): decisión IN/OUT, sesiones, firma Ed25519, reloj, matching 1:N, protocolo
apps/admin/             Panel central (Next.js) → Vercel
apps/kiosk/             App de tienda (Capacitor) — pendiente (Fase 3)
supabase/migrations/    Esquema, RBAC/RLS, ingesta, dispositivos, biometría
supabase/functions/     Edge Function device-api (activación, push/pull firmados)
supabase/tests/         Pruebas SQL (RLS, ingesta, correcciones, dispositivos)
scripts/                test-db.sh, test-edge.sh, sync-shared.mjs
docs/                   Arquitectura, seguridad, offline, despliegue, pruebas, estado
```

## Desarrollo
```bash
pnpm install
pnpm test                 # pruebas unitarias del core
pnpm test:db              # migraciones + 70 comprobaciones SQL en Postgres local (usuario no root)
pnpm test:edge            # integración device-api (requiere Deno y Postgres local)
cd apps/admin && cp .env.example .env.local && pnpm dev
```

## Documentación
[Arquitectura](docs/ARCHITECTURE.md) · [Offline y sincronización](docs/OFFLINE_SYNC.md) · [Seguridad y privacidad](docs/SECURITY_PRIVACY.md) · [Biometría](docs/BIOMETRICS.md) · [Despliegue](docs/DEPLOYMENT.md) · [Plan de pruebas](docs/TEST_PLAN.md) · [Infraestructura](docs/CONNECTORS_AND_INFRASTRUCTURE.md) · [Estado](docs/STATUS.md)
