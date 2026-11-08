# Arquitectura

```
 Sede central (admin)                 Supabase (us-east-2)                       Tienda (teléfono compartido)
 ┌──────────────────┐  HTTPS+JWT  ┌───────────────────────────────┐  HTTPS+Ed25519  ┌──────────────────────────┐
 │ Panel Next.js    │────────────▶│ PostgREST + RLS (rol admin)   │◀────────────────│ App Capacitor (Fase 3)   │
 │ (Vercel)         │  MFA aal2   │ Edge Function device-api      │  challenge/push │ SQLite cifrado           │
 └──────────────────┘             │ Postgres: public / private    │  /pull          │ Motor IN/OUT (core)      │
                                  │ Vault: template_enc_key       │                 │ Biometría local (Fase 4) │
                                  └───────────────────────────────┘                 └──────────────────────────┘
```

## Decisiones
| Decisión | Motivo |
|---|---|
| Monorepo TS con `packages/core` compartido | La misma lógica de decisión, firma y protocolo en el teléfono, la Edge Function y las pruebas. `scripts/sync-shared.mjs` la copia a Deno. |
| Teléfonos **sin** usuario de Supabase | Un teléfono comprometido no obtiene un JWT con acceso a tablas. Solo habla con `device-api`, que llama a funciones `private.*` (security definer) con validación completa en el servidor. |
| Autenticación de teléfono: clave Ed25519 + desafío de un solo uso | No depende del reloj del teléfono (que puede estar mal durante días sin conexión). Activación con código de un solo uso y prueba de posesión de la clave. |
| Eventos firmados individualmente | El servidor detecta manipulación local de la base del teléfono. Un evento con firma inválida se rechaza y se registra como evento de seguridad. |
| `attendance_events` solo de inserción + `attendance_sessions` como proyección | Nunca se edita ni se borra una marcación; las correcciones son registros auditados aparte y las sesiones se reconstruyen. |
| Plantillas cifradas dentro de Postgres con clave en Vault | La clave nunca sale de la BD; ni el panel ni la API REST pueden leer plantillas; un volcado de tablas no las expone. |
| Panel solo con la clave pública + sesión del usuario | Toda acción del panel pasa por RLS/RPC; **no hay `service_role` en Vercel**. |
| Capacitor (propuesto) con módulos nativos | La UI y la lógica en TS se comparten; la cámara, la inferencia, SQLCipher y el almacén de claves en Kotlin/Swift. Se reevaluará si el SDK biométrico elegido solo ofrece integración nativa. |

## Modelo de datos (resumen)
- **Territorio:** `organizations → regions (país, zona horaria) → stores (is_central)`.
- **Personas:** `employees` (estado, historial), `employee_store_assignments` (permanente/temporal, fechas efectivas, revocación).
- **Acceso:** `admins`, `roles`, `role_permissions`, `admin_role_grants` (ámbito: plataforma, organización, región o tienda).
- **Dispositivos:** `devices`, `device_enrollments` (hash del código), `device_credentials` (clave pública), `device_health`, `device_policy_versions`.
- **Biometría:** `model_versions`, `liveness_policy_versions`, `biometric_consents`, `biometric_enrollments`, `private.biometric_template_versions`.
- **Asistencia:** `attendance_events` (solo inserción), `attendance_corrections`, `attendance_sessions`, vista `attendance_events_effective`.
- **Operación:** `incidents`, `security_events`, `audit_log`, `sync_batches`, `sync_acknowledgements`, `retention_requests`.

**Qué se replica a cada tienda:** solo los empleados con asignación vigente a esa tienda, estado activo, enrolamiento y consentimiento vigentes; el nombre abreviado («María L.»), las plantillas del modelo vigente, el último evento (para continuar la alternancia) y la caducidad de la autorización (*lease*). Nada más.
