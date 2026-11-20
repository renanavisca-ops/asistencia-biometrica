# Arquitectura biométrica (implementación real, 2026-11-20)

Todo el reconocimiento y la prueba de vida se ejecutan **en el teléfono, sin red**, dentro de la WebView de la app
(Capacitor) con WebAssembly. No hay módulo nativo Kotlin/Swift: el diseño inicial que lo proponía se sustituyó porque
MediaPipe y ONNX Runtime funcionan en WASM con el mismo código en Android e iOS.

```
 Cámara (getUserMedia en la WebView)
   │ fotogramas
   ▼
 A. Detección y calidad ── MediaPipe Face Landmarker (WASM): caja, 478 puntos, parpadeo; calidad: tamaño, luz, nitidez, pose
 B. Reconocimiento ────── alineación 112×112 (5 puntos) → SFace ONNX (ONNX Runtime WASM) → embedding 128-d L2
 C. Prueba de vida ────── pasiva MiniFASNet V2+V1SE (ONNX) + desafío activo (parpadeo o aleatorio) + continuidad A–B
 D. Plantillas ────────── galería local de la tienda (SQLCipher), solo plantillas del MISMO modelo; 1:N en packages/core
 E. Asistencia ────────── KioskService (ya existente): decide ENTRADA/SALIDA, firma Ed25519, cola offline, sincroniza
```

## Código
| Pieza | Archivo |
|---|---|
| Contratos por capacidad (`FaceDetector`, `FaceRecognizer`, `LivenessDetector`) | `apps/kiosk/src/infra/biometric/types.ts` |
| Contrato del motor para la asistencia (`BiometricEngine`, `Identification`) | `apps/kiosk/src/infra/biometric/engine.ts`, `domain/kiosk.ts` |
| Motor gratuito (MediaPipe + SFace + MiniFASNet) | `freeEngine.ts`, `mediapipeDetector.ts`, `sfaceRecognizer.ts`, `passiveLiveness.ts`, `align.ts`, `quality.ts` |
| Desafío activo | `activeChallenge.ts` |
| **Cadena de captura única** (usada por la marcación y por el modo validación) | `capture.ts` (`runCapture`) |
| Comparación 1:N, margen entre candidatos, compatibilidad de modelo | `packages/core/src/matching.ts` |
| Adaptadores comerciales: **solo interfaz**, lanzan `EngineNotIntegratedError` (no simulan resultados) | `commercial.ts` |
| Enrolamiento guiado (sede central, administrador, documento, 6 pasos) | `apps/kiosk/src/ui/Enrollment.tsx` + `enroll_biometric` (servidor) |
| Modo validación biométrica (mediciones con personas, sin asistencia) | `ui/BiometricValidation.tsx` → `device-api/trials` → `biometric_trials` → panel «Validación biométrica» |

La lógica de asistencia no conoce el motor: solo recibe `Identification` (empleado, puntuación, margen, PAD, modelo).

## Decisión del sistema en cada marcación
1. Rostro frontal con calidad (2 fotogramas) → identidad A + puntuación pasiva.
2. Desafío según la política `activeChallenge`: **1 = parpadeo** (vigente, decisión del propietario), **2 = aleatorio**
   (parpadeo o giro a un lado, más difícil de reproducir con un vídeo), **0 = solo pasiva** (no recomendado).
3. Vuelta de frente → identidad B; A y B deben ser la misma persona (continuidad).
4. Se rechaza si el desafío no se cumple, si cambia la persona o si la pasiva < `padThreshold`.
5. 1:N contra los empleados autorizados de la tienda: se acepta solo si el mejor ≥ `matchThreshold` **y** supera al segundo
   por `matchMargin`. Sin umbrales publicados el teléfono no reconoce a nadie. Fallos repetidos → enfriamiento.
6. Sin selección manual de nombre ni de entrada/salida (la app decide; al salir pregunta solo almuerzo o fin de turno).

## Plantillas, versiones y reemplazo del motor
- Cada plantilla lleva `recognition_model_id` (p. ej. `sface@2021dec`); el teléfono descarta las de otro modelo.
- **No se asume compatibilidad entre modelos**: cambiar de motor exige reenrolar (los traslados de tienda no).
- Plantillas cifradas en el servidor (clave en Vault) y en el teléfono (SQLCipher); revocación por baja con borrado a 30 días.
- Modelos empaquetados con SHA-256 fijado (`scripts/fetch-models.mjs`): un archivo cambiado rompe la compilación.
- Política por organización y versionada (`device_policy_versions`): umbrales y modo de desafío; auditada.
- Pendiente para comercializar: selección de motor por organización y reenrolamiento controlado por estado (ver
  docs/PENDIENTES_PRODUCCION.md); hoy hay un solo motor.

## iOS (preparación, NO probado)
- Compartido sin cambios: toda la cadena (TypeScript + WASM), la lógica de asistencia, la firma y la sincronización.
- Requiere en iOS: proyecto Capacitor iOS (`npx cap add ios`), permiso de cámara (`NSCameraUsageDescription`), WKWebView
  con `getUserMedia` (iOS 14.3+), almacenamiento cifrado (plugin SQLite con SQLCipher para iOS) y clave del dispositivo en
  el Keychain/Secure Enclave (equivalente al Keystore de Android).
- Riesgos a medir: rendimiento de WASM en WKWebView (sin hilos en algunos casos), memoria con SFace (38,7 MB).
- **No se ha compilado ni ejecutado en un dispositivo Apple** (requiere Mac con Xcode; la cuenta de desarrollador de Apple
  solo es necesaria para publicar, no para probar en un iPhone propio).
