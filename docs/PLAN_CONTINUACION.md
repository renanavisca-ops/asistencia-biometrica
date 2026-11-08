# Plan de continuación por etapas (desde v0.1.2)

Cada etapa termina con: qué había, qué se hizo, pruebas, qué funciona, pendientes e inversiones posibles.
Estados: **Prototipo funcional → Piloto controlado → Validado para producción → Listo para comercializar** (no equivalentes).

| Etapa | Objetivo | Entregables | Criterio de salida | Depende de ti |
|---|---|---|---|---|
| **1. Motor gratuito en el teléfono** (Fase C) | Reconocimiento real offline | Módulo nativo Android: cámara, MediaPipe, SFace (ONNX), calidad; interfaces intercambiables; adaptadores comerciales vacíos | La app genera embeddings reales en el HONOR y mide latencia; lista manual eliminada del flujo normal | Aprobar aumento de tamaño del APK |
| **2. Prueba de vida experimental** (Fase C) | Rechazar fotos/pantallas | MiniFASNet + desafío activo aleatorio; registro de intentos fallidos | Medición con fotos impresas, pantallas y vídeo (APCER/BPCER con tamaño de muestra) | Materiales de ataque (fotos/pantallas) |
| **3. Enrolamiento central** (Fase E) | Registrar rostros en sede central | Modo enrolamiento con login admin+MFA, ≥5 muestras, duplicados 1:N, plantillas versionadas por motor | Empleado enrolado en central es reconocido en la tienda tras sincronizar, sin selección manual | Voluntarios con consentimiento firmado |
| **4. Integración y calibración** (Fase D/J) | Umbrales con datos reales | **Organización de pruebas aislada** (`is_test`), formato de consentimiento para voluntarios, herramienta de calibración, métricas FMR/FNMR por condiciones, **borrado total verificable** de la organización de pruebas al terminar | Resultados documentados en PRUEBAS_RECONOCIMIENTO.md (sin cifras inventadas) y certificado de borrado | Voluntarios con consentimiento (confirmado) |
| **5. Seguridad sin bloquear el teléfono** (Fase F) | El teléfono de la tienda NO es exclusivo: la app se abre y cierra normalmente | Al volver a la app siempre aparece la pantalla de marcación limpia; ajustes del encargado protegidos con PIN; FLAG_SECURE; detección de root/depuración; límite de intentos fallidos y alertas de suplantación en el panel; Play Integrity en activación/sincronización (gratuito) | Un empleado no puede ver ni alterar datos aunque use el teléfono para otras cosas | — (decidido: sin modo quiosco bloqueado) |
| **6. Marcación supervisada** (Fase G) | Excepciones auditadas | PIN de supervisor por tienda (hash, intentos limitados), motivo, aprobación posterior en panel; nunca “verificado biométricamente” | Flujo completo offline con aprobación en panel | — |
| **7. Panel profesional** (Fase H) | Lo que falta | Estado biométrico por empleado, enrolamientos pendientes, plantillas activas/revocadas, alertas de suplantación, versiones de motor, aprobación de períodos, .xlsx | Revisión contigo | Prioridades |
| **8. iOS** (Fase I) | Segunda plataforma | Módulo Swift equivalente; compilación en runner macOS | App instalable vía TestFlight | Cuenta Apple Developer (99 USD/año) — **coste** |
| **9. Validación y preparación comercial** (Fase J/K) | Piloto controlado | Pruebas de campo, aislamiento, costos por organización, respaldos, monitoreo, planes (sin cobro) | Informe de piloto | Tienda piloto, revisión legal — **posible coste** |

## Inversiones que podrían ser necesarias (no se ejecuta ninguna sin autorización)
- Licencia comercial de modelo de reconocimiento o SDK con PAD certificado (cotización).
- Cuenta Apple Developer (iOS).
- Plan Vercel Pro para uso comercial (Hobby es no comercial).
- Revisión legal por país (biometría como dato sensible).
- Posible upgrade de cómputo en Supabase con muchas organizaciones.

## Decisiones del propietario (2026-11-08)
- **SFace como motor gratuito EXPERIMENTAL** para desarrollo y piloto; antes de vender, resolver la licencia (revisión legal, licenciar un modelo o entrenar uno propio).
- **Enrolamiento desde la app en modo enrolamiento** (teléfono de la sede central, administrador con credenciales + MFA).
- **Sin modo quiosco bloqueado**: el teléfono de la tienda se usa también para otras cosas; la app debe poder abrirse y cerrarse.
- **Voluntarios disponibles**, con la condición de que **todos sus datos se borren al final de las pruebas** y la operación real empiece en limpio. Implementación: todas las pruebas en una organización marcada `is_test`; función de borrado total (empleados, documentos, plantillas, eventos, dispositivos) solo para superadministrador y solo sobre organizaciones de prueba; verificación posterior de que no quedan registros. Los datos de prueba actuales («TU AMIGO GUA») también se pueden borrar antes de arrancar.
