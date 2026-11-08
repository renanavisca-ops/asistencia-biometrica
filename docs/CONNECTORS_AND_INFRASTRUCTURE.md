# Conectores e infraestructura (verificado 2026-11-08)

Sin secretos. Solo recursos realmente comprobados.

| Recurso | Estado | Uso en este proyecto |
|---|---|---|
| GitHub `renanavisca-ops/asistencia-biometrica` | Creado por el propietario. git push/fetch y API de GitHub verificados vía el proxy de la sesión (`gh auth status` reporta «token inválido» porque la credencial la inyecta el proxy; las llamadas funcionan). CI: 7/7 ejecuciones en verde (core, database, edge-functions, kiosk, android-apk) | Código, CI, artefacto APK |
| Supabase org `renanavisca-ops's Org` (plan Pro) | Conector MCP operativo | — |
| Supabase proyecto `grsezvfrkxzurgelyujv` (us-east-2) | Reutilizado por decisión del propietario. Contenido anterior ("Centro de Capacitacion": 5 tablas, 3 funciones, 1 usuario) **borrado** el 2026-11-08. Migraciones 0100/0200/0300 aplicadas; checksums MD5 idénticos a los archivos del repo | Backend único del sistema |
| Vercel equipo `Efren's projects` (Hobby) | Conector MCP con lectura; **sin permiso para crear proyectos**. Proyecto `asistencia-biometrica` creado por el propietario desde el dashboard | Panel: https://asistencia-biometrica.vercel.app |
| Otros proyectos Supabase (`mobile-chat-mvp`, `Agente de Responsabilidades`) y Vercel (`mobile-chat-mvp`, `new-control-de-costales`, `landing-ia-latam`, `project-giklo`) | **No tocar.** No relacionados | — |

## Pendiente del propietario
- Renombrar el proyecto Supabase a "asistencia-biometrica" en el dashboard (la API MCP no permite renombrar).
- Cuenta Apple Developer + macOS (runner o equipo) para compilar/firmar iOS.
- Cuenta Google Play Console para distribución Android de prueba (opcional; también APK interno).
- Países concretos de Centroamérica para zonas horarias y revisión legal.

## Avisos del advisor de Supabase aceptados (intencionales)
- `rls_enabled_no_policy` en `private.biometric_template_versions`, `private.device_challenges`, `public.device_enrollments`: bloqueadas a propósito; solo service_role (Edge Functions).
- `authenticated_security_definer_function_executable` en los RPC administrativos: cada función valida permiso, ámbito y MFA internamente (ver supabase/tests/10_rls_and_ingest.sql).
