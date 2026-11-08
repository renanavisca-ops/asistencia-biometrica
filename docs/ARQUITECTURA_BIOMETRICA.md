# Arquitectura biométrica intercambiable (diseño)

```
 Cámara (CameraX / AVFoundation)
   │ fotogramas
   ▼
 ┌──────────────────────── Módulo nativo (Kotlin / Swift) ────────────────────────┐
 │ A. FaceDetector      → caja, 478 puntos, pose, nitidez, luz  (MediaPipe)        │
 │ C. LivenessDetector  → pasivo (MiniFASNet) + desafío activo (parpadeo/giro)     │
 │ B. FaceRecognizer    → alineación 112×112 → embedding (SFace ONNX, 128-d)        │
 │    Devuelve a JS: { embedding, quality, liveness{score,kind}, engine, version }  │
 └──────────────────────────────────────────────────────────────────────────────────┘
   ▼
 D. Gestión de plantillas (TS): galería local de la tienda (SQLCipher), matchOneToN (core)
   ▼
 E. Motor de asistencia (TS, ya existente): decideNextEvent → evento firmado → cola → sync
```

## Contratos (TypeScript, `apps/kiosk/src/infra/biometric/`)
- `FaceDetector`, `FaceRecognizer`, `LivenessDetector`: interfaces por capacidad.
- `BiometricEngine` (ya existe) pasa a **componer** las tres y exponer `identify(gallery, policy)` y `enroll(samples)`.
- Adaptadores:
  - `FreeFaceRecognitionAdapter` (MediaPipe + SFace) — **experimental**.
  - `FreeLivenessAdapter` (MiniFASNet + desafío activo) — **experimental**.
  - `CommercialFaceRecognitionAdapter`, `CommercialLivenessAdapter` — **solo interfaz**; lanzan `ENGINE_NOT_INTEGRATED`. No simulan resultados.
- La lógica de asistencia **no conoce** el motor: solo recibe `Identification` (ya existe).

## Plantillas y compatibilidad
- Cada plantilla lleva: empleado, organización, `engine` (p. ej. `free-sface`), `model_version` (`sface@2021dec`), `template_format` (`f32le-128-l2`), fecha, estado, `key_id` de cifrado.
- **Embeddings de modelos distintos no son compatibles**: el teléfono solo recibe plantillas del motor que tiene instalado; si la organización cambia de motor, se abre un **reenrolamiento controlado** (estado por empleado: pendiente/completo) — sin migraciones automáticas.
- Selección de motor **por organización** (`organizations.biometric_engine`), solo entre motores con estado `approved` en `model_versions`. Cambio auditado y restringido a superadministrador.
- Rotación de claves: `key_id` por plantilla; procedimiento de re-cifrado documentado (pendiente).

## Enrolamiento central
App en **modo enrolamiento** en un dispositivo registrado a la **sede central**, desbloqueado por un administrador con credenciales + MFA. Captura ≥5 muestras con calidad y prueba de vida → comprobación de duplicados 1:N contra la organización (en servidor) → `enroll_biometric` (existe) → distribución a tiendas en la siguiente sincronización. Nunca desde la pantalla pública de marcación.

## Política configurable (ya en `device_policy_versions`)
`matchThreshold`, `matchMargin`, `padThreshold` (hoy vacíos = sin calibrar → el sistema rechaza). Se publican solo con evidencia de calibración (docs/PRUEBAS_RECONOCIMIENTO.md).
