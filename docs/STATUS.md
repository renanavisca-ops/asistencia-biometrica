# Estado del proyecto

| Área | Estado | Evidencia |
|---|---|---|
| Fase 0 — descubrimiento de conectores | Completado | Ver docs/CONNECTORS_AND_INFRASTRUCTURE.md (pendiente de redactar) |
| Supabase: reutilizar proyecto `grsezvfrkxzurgelyujv` (antes "Centro de Capacitacion") | **En curso** | Restaurado y ACTIVE_HEALTHY. Limpieza del esquema anterior pendiente de confirmación en el servidor MCP |
| Repositorio GitHub | **Bloqueado** | Lo debe crear el propietario: `renanavisca-ops/asistencia-biometrica` (privado, vacío) |
| packages/core (motor IN/OUT, sesiones, firma Ed25519, reloj, matching 1:N, protocolo) | Completado | 31 pruebas vitest OK, typecheck OK |
| Migraciones SQL + RLS | No iniciado | — |
| Edge Functions (device-activate, device-sync, admin-enroll) | No iniciado | — |
| Panel admin (Next.js) | No iniciado | — |
| App de tienda (Capacitor) | No iniciado | — |
| Reconocimiento facial 1:N | **NO IMPLEMENTADO** | Solo existe el comparador de vectores; falta modelo real |
| Prueba de vida / PAD | **NO IMPLEMENTADO** | Sin modelo evaluado. El sistema NO es apto para producción |

Decisiones del propietario (2026-11-08): reutilizar el proyecto Supabase "Centro de Capacitacion" borrando su contenido; repo creado por el propietario; biometría por dos vías en paralelo (prototipo open-source + evaluación comercial); operación inicial en Centroamérica (países concretos por confirmar).
