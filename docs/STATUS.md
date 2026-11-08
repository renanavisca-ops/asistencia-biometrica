# Estado del proyecto

| Área | Estado | Evidencia |
|---|---|---|
| Fase 0 — descubrimiento de conectores | Completado | docs/CONNECTORS_AND_INFRASTRUCTURE.md |
| Supabase `grsezvfrkxzurgelyujv` | Completado | Contenido anterior borrado; 3 migraciones aplicadas (MD5 verificados) |
| Repositorio GitHub + CI | Completado | `renanavisca-ops/asistencia-biometrica`, workflow .github/workflows/ci.yml |
| packages/core (motor IN/OUT, sesiones, firma Ed25519, reloj, matching 1:N, protocolo) | Completado | 31 pruebas vitest OK, typecheck OK |
| Migraciones SQL + RBAC/RLS + ingesta + correcciones | Completado | 45 comprobaciones en supabase/tests/10_rls_and_ingest.sql (`pnpm test:db`) |
| Edge Functions (device-activate, device-sync, admin-enroll) | No iniciado | — |
| Panel admin (Next.js) | No iniciado | — |
| App de tienda (Capacitor) | No iniciado | — |
| Reconocimiento facial 1:N | **NO IMPLEMENTADO** | Solo existe el comparador de vectores; falta modelo real |
| Prueba de vida / PAD | **NO IMPLEMENTADO** | Sin modelo evaluado. El sistema NO es apto para producción |

Decisiones del propietario (2026-11-08): reutilizar el proyecto Supabase "Centro de Capacitacion" borrando su contenido; repo creado por el propietario; biometría por dos vías en paralelo (prototipo open-source + evaluación comercial); operación inicial en Centroamérica (países concretos por confirmar).
