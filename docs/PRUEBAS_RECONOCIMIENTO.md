# Pruebas de reconocimiento facial

> Motor: **sface@2021dec (EXPERIMENTAL)** + MediaPipe Face Landmarker. Prueba de vida: **no implementada** (Etapa 2).
> Las cifras de este documento son **pruebas técnicas de la cadena**, NO métricas de precisión. La precisión (FMR/FNMR con intervalos
> de confianza) se medirá con voluntarios en la Etapa 4 y se publicará aquí con el tamaño de muestra.

## 2026-11-08 — Etapa 1: motor en la app (WebAssembly, sin red)
Entorno: Chromium headless (mismo motor de la WebView de Android) en servidor de CI; **no** es un teléfono.

### Coherencia del motor (`apps/kiosk/test-biometric-engine.mjs`)
Imágenes públicas (mediapipe-assets, OpenCV samples). “Misma persona” = transformaciones de **la misma foto** (luz, rotación, escala).
| Caso | Resultado |
|---|---|
| Misma persona (5 pares) | similitud 0,890 – 0,996 |
| Personas distintas (3 pares) | similitud 0,052 – 0,070 |
| Imagen sin rostro | rechazada `no_face` |
| Dos personas | rechazada `multiple_faces` |
| Rostro girado (Lena) | rechazado `not_frontal` |
| Tiempos | carga de modelos 1,7 s · detección ~115 ms · embedding ~55 ms (servidor) |

### Extremo a extremo (`apps/kiosk/face-e2e.mjs`)
App compilada + cámara simulada (vídeo de un retrato) → device-api local → Postgres local con migraciones reales. Umbral **provisional** 0,5 / margen 0,1 solo para la prueba.
| Caso | Resultado |
|---|---|
| Persona A enrolada frente a la cámara | Reconocida sin selección manual, ENTRADA sincronizada, score 0,988, margen 0,901, 2,9 s desde el toque |
| Persona B enrolada | Reconocida correctamente (no confundida con A), score 0,992, 3,0 s |
| Persona A **no** enrolada (solo B) | «No reconocido», ninguna marcación registrada, 2,8 s |

Limitación: las plantillas se generaron de la misma foto mostrada a la cámara; demuestra la integración, no la exactitud entre capturas distintas.

### Pendiente
- Medir en el HONOR LGN-NX3 (Diagnóstico del motor): carga, detección, embedding, temperatura.
- Calibración con voluntarios (Etapa 4): FMR/FNMR por luz, lentes, distancia; umbrales publicados por organización.
