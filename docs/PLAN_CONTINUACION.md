# Plan de continuación por etapas (desde v0.1.2)

Cada etapa termina con: qué había, qué se hizo, pruebas, qué funciona, pendientes e inversiones posibles.
Estados: **Prototipo funcional → Piloto controlado → Validado para producción → Listo para comercializar** (no equivalentes).

| Etapa | Objetivo | Entregables | Criterio de salida | Depende de ti |
|---|---|---|---|---|
| **1. Motor gratuito en el teléfono** (Fase C) | Reconocimiento real offline | Módulo nativo Android: cámara, MediaPipe, SFace (ONNX), calidad; interfaces intercambiables; adaptadores comerciales vacíos | La app genera embeddings reales en el HONOR y mide latencia; lista manual eliminada del flujo normal | Aprobar aumento de tamaño del APK |
| **2. Prueba de vida experimental** (Fase C) | Rechazar fotos/pantallas | MiniFASNet + desafío activo aleatorio; registro de intentos fallidos | Medición con fotos impresas, pantallas y vídeo (APCER/BPCER con tamaño de muestra) | Materiales de ataque (fotos/pantallas) |
| **3. Enrolamiento central** (Fase E) | Registrar rostros en sede central | Modo enrolamiento con login admin+MFA, ≥5 muestras, duplicados 1:N, plantillas versionadas por motor | Empleado enrolado en central es reconocido en la tienda tras sincronizar, sin selección manual | Voluntarios con consentimiento firmado |
| **4. Integración y calibración** (Fase D/J) | Umbrales con datos reales | Herramienta de calibración, métricas FMR/FNMR por condiciones, publicación de umbrales | Resultados documentados en PRUEBAS_RECONOCIMIENTO.md (sin cifras inventadas) | Sesiones de prueba con voluntarios |
| **5. Seguridad y quiosco** (Fase F) | Teléfono dedicado | Lock Task (device owner) o fijación de pantalla, arranque automático, recuperación tras cierre, alertas de suplantación en panel | Empleado no puede salir de la app sin el encargado | Decisión sobre restablecer el teléfono de prueba |
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
