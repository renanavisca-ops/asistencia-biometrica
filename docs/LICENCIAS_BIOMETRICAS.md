# Licencias de los componentes biométricos

> Revisión técnica, **no asesoría legal**. Antes de vender el producto, un abogado debe confirmar la procedencia de los
> datos de entrenamiento de cada modelo y las obligaciones de atribución. Última revisión: 2026-11-20.

Se distinguen tres capas, porque una licencia permisiva en una no cubre las otras:
**código** (el programa), **pesos** (el archivo del modelo entrenado) y **datos de entrenamiento** (las fotos con que se entrenó).

## Lo que se distribuye dentro de la app (APK)
| Componente | Uso | Archivo / versión | Tamaño | Código | Pesos | Datos de entrenamiento | Uso comercial |
|---|---|---|---|---|---|---|---|
| MediaPipe Face Landmarker | Detección, 478 puntos, parpadeo | `face_landmarker.task` float16/1 (SHA-256 fijado en `scripts/fetch-models.mjs`) | 3,8 MB | Apache-2.0 | Apache-2.0 (model card de Google) | Descritos en la model card de Google | ✅ Permitido con atribución |
| MediaPipe Tasks Vision (WASM) | Ejecución del detector | `@mediapipe/tasks-vision` 1.1.1 | — | Apache-2.0 | — | — | ✅ Con atribución |
| ONNX Runtime Web (WASM) | Ejecución de SFace y MiniFASNet | `onnxruntime-web` 1.30.0 | — | MIT | — | — | ✅ Con atribución |
| **SFace** (OpenCV Zoo) | Reconocimiento (embedding 128-d) | `sface_2021dec.onnx` | 38,7 MB | Apache-2.0 | Apache-2.0 (directorio del modelo en opencv_zoo) | **No verificada.** El artículo de SFace (TIP 2021, arXiv 2205.12010) informa experimentos con CASIA-WebFace, VGGFace2 y MS-Celeb-1M; **no se pudo confirmar** con cuál se entrenó el modelo publicado. Esos conjuntos tienen condiciones de uso académico o fueron retirados (MS-Celeb-1M). | ⚠️ **Experimental**: no usar comercialmente sin revisión legal de la procedencia |
| **MiniFASNet V2 + V1SE** (Silent-Face, Minivision) | Prueba de vida pasiva | `minifasnet_v2_2.7.onnx`, `minifasnet_v1se_4.0.onnx` (convertidos por nosotros a ONNX, paridad 1,2e-7) | 1,7 MB c/u | Apache-2.0 (repositorio) | **Sin licencia explícita de los pesos**; un índice de pesos de terceros los marca «no usar en un producto comercial» | No documentados por el autor | ⚠️ **Experimental**: solo validación |
| Desafío activo (parpadeo / giro) | Prueba de vida activa | Código propio sobre MediaPipe | — | Propio | — | — | ✅ |

**Obligación vigente (Apache-2.0 / MIT):** incluir avisos de atribución. Se distribuyen en `apps/kiosk/public/THIRD_PARTY_NOTICES.txt`.

## Descartados por licencia
| Opción | Motivo |
|---|---|
| InsightFace `buffalo_l` / ArcFace (pesos oficiales) | Pesos **solo no comerciales** |
| EdgeFace (Idiap) | CC BY-NC-SA 4.0 (no comercial) |
| MobileFaceNet de repositorios de terceros | Típicamente entrenados con MS1M (retirado, no comercial) o sin procedencia |
| Modelos entrenados con DigiFace-1M | Condiciones no comerciales según fuentes secundarias (sin confirmar) |
| Pesos derivados de CelebA-Spoof | El conjunto CelebA-Spoof tiene cláusula no comercial |

## Conclusión para comercializar
El motor gratuito actual sirve para **validar el producto con personas reales** (y está aislado detrás de interfaces
intercambiables), pero **dos de sus modelos no tienen la procedencia necesaria para un producto comercial**: SFace (datos de
entrenamiento) y MiniFASNet (licencia de pesos). Opciones cuando se decida vender (todas con costo; **no contratadas**):
1. Licenciar un SDK biométrico comercial con prueba de vida certificada (iBeta nivel 1/2) y licencia de distribución móvil.
2. Licenciar un modelo de reconocimiento con datos de procedencia documentada.
3. Entrenar un modelo propio con datos con consentimiento (costo de datos, cómputo y validación).
El cambio no requiere rehacer la app: se agrega un adaptador (`apps/kiosk/src/infra/biometric/commercial.ts`) y se
reenrola a los empleados con el nuevo modelo (los embeddings de modelos distintos no son compatibles).

Fuentes: [opencv_zoo / face_recognition_sface](https://github.com/opencv/opencv_zoo) ·
[SFace, arXiv 2205.12010](https://arxiv.org/abs/2205.12010) · [Silent-Face-Anti-Spoofing](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing) ·
[índice de pesos UniFace (MiniFASNet)](https://huggingface.co/yakhyo/uniface-weights) · [MediaPipe Face Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker) ·
[InsightFace (licencia)](https://pypi.org/project/insightface) · [EdgeFace](https://huggingface.co/Idiap/EdgeFace-Base)
