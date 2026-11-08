# Estado actual — Asistencia Tienda (auditoría Fase A, 2026-11-08)

Verificado directamente en código, base de datos y pruebas (no en el resumen).

| Funcionalidad | Estado | Evidencia |
|---|---|---|
| Multiempresa con aislamiento (RLS) | ✅ Funciona | `supabase/migrations/*0200*`; 15 comprobaciones de aislamiento en `supabase/tests/10_*` |
| Empleados, código automático, documento cifrado sin duplicados | ✅ Funciona | migración 0500; 16 pruebas (`tests/30_*`) |
| Asignación a tiendas, traslados, bajas | ✅ Funciona | `transfer_employee`, `set_employee_status`; pruebas 10 y E2E |
| Activación de dispositivos (código único + prueba de posesión Ed25519) | ✅ Funciona | `device-api`; 9 pasos de integración; teléfono real activado |
| Marcación automática IN/OUT, anti-doble, confirmación de salida anticipada | ✅ Funciona | `packages/core/src/attendance.ts`; 42 pruebas core; probado en HONOR LGN-NX3 |
| Offline: SQLCipher, cola, reloj monotónico, sincronización idempotente | ✅ Funciona | `apps/kiosk/src/domain`; 13 pruebas + E2E con corte de red |
| Registros firmados, inmutables, correcciones auditadas | ✅ Funciona | triggers append-only; pruebas SQL |
| Panel: reportes por jornada, incidencias, exportación CSV, auditoría, MFA | ✅ Funciona | `apps/admin`; desplegado en Vercel |
| **Reconocimiento facial** | ❌ No existe | Motor `SIMULADO@0` con selección manual (solo pruebas) |
| **Prueba de vida** | ❌ No existe | — |
| **Enrolamiento facial central** | ⚠️ Solo backend | `enroll_biometric` (sede central, consentimiento, PAD, 3–10 muestras); sin captura |
| Modo quiosco completo | ⚠️ Parcial | FLAG_SECURE, pantalla encendida, sin backup; falta Lock Task |
| Marcación supervisada | ❌ No existe | El esquema lo admite (`source = supervised_exception`) |
| iOS | ❌ No iniciado | Requiere macOS + Apple Developer |
| Exportación Excel nativa (.xlsx) | ⚠️ CSV compatible con Excel | — |
| Aprobación de períodos | ❌ No existe | — |

**Pruebas automáticas:** 151 (42 core + 13 kiosk + 86 SQL + 9 integración + 1 E2E), todas en verde; CI en GitHub Actions compila el APK.

**Clasificación honesta del sistema hoy:** *prototipo funcional de la infraestructura de asistencia*, **sin biometría**. No es piloto ni producción.
