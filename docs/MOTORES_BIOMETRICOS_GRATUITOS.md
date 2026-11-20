# Motores biométricos gratuitos (Fase B — investigación 2026-11-08)

Se verifica por separado: licencia del **código**, de los **pesos** y de los **datos de entrenamiento**. Una licencia permisiva en los pesos NO resuelve por sí sola los derechos sobre los datos con que se entrenaron.

## Detección de rostro y puntos faciales
| Opción | Código | Pesos | Datos | Veredicto |
|---|---|---|---|---|
| **MediaPipe Face Detector (BlazeFace) / Face Landmarker** | Apache-2.0 | Apache-2.0 (model cards de Google) | Documentados en model card | ✅ **Recomendado**: detección, 478 puntos (alineación, pose, parpadeo para prueba activa). Android e iOS oficiales. |
| YuNet (OpenCV Zoo) | MIT | MIT | No verificado | ✅ Alternativa ligera |
| Google ML Kit Face Detection | Propietario gratuito | — | — | ⚠️ Gratis pero cerrado; no identifica personas |

## Reconocimiento (embeddings 1:N)
| Opción | Pesos | Datos de entrenamiento | Veredicto |
|---|---|---|---|
| **SFace (OpenCV Zoo, MobileFaceNet + pérdida SFace)** | Apache-2.0 (directorio del modelo) | **No verificado** (el paper usa conjuntos académicos habituales; arxiv no accesible desde este entorno) | 🧪 **Recomendado como motor gratuito EXPERIMENTAL**: licencia de pesos permisiva, 128-d, ONNX ~37 MB, apto para gama media. Requiere revisión legal de procedencia antes de uso comercial |
| InsightFace `buffalo_l` / ArcFace | **No comercial** | MS1M/Glint | ❌ No usar en producto |
| EdgeFace (Idiap) | **CC BY-NC-SA 4.0** | — | ❌ No comercial |
| Modelos entrenados con DigiFace-1M (sintético) | — | Fuente secundaria indica uso **no comercial** | ❌ Hasta confirmar |
| MobileFaceNet de terceros (varios repos) | Variable | Típicamente MS1M (retirado, no comercial) | ❌ Salvo procedencia clara |

**Conclusión:** no existe hoy (según lo verificado) un modelo de reconocimiento gratuito con procedencia de datos limpia para uso comercial. Se implementa SFace detrás de la interfaz intercambiable, **etiquetado como experimental**; la decisión comercial (licenciar un modelo, comprar un SDK o entrenar uno propio con datos con consentimiento) queda para después de validar el producto.

## Prueba de vida (PAD)
| Opción | Tipo | Licencia | Veredicto |
|---|---|---|---|
| **Silent-Face-Anti-Spoofing (MiniFASNet)** | Pasiva (1 imagen) | Repo Apache-2.0; licencia de pesos no explícita | 🧪 Experimental. El autor advierte baja robustez entre cámaras |
| **Desafío activo con MediaPipe** (parpadeo / giro aleatorio) | Activa | Apache-2.0 | 🧪 Útil contra fotos impresas; **un vídeo puede superarlo** |
| Señales de calidad (textura, reflejos de pantalla, moiré) | Heurística | Propio | 🧪 Complementa |

La combinación **pasiva + activa aleatoria** es la mejor opción gratuita, pero **no está certificada** (ISO 30107-3/iBeta) y no protege contra deepfakes ni inyección de cámara en teléfonos rooteados. Se mide con fotos, pantallas y vídeos (docs/PRUEBAS_ANTISPOOFING.md) y se documentan sus límites.

## Tiempo de ejecución
- **ONNX Runtime Android/iOS** (MIT) para SFace y MiniFASNet; **MediaPipe Tasks** (Apache-2.0) para detección/puntos.
- Todo local, sin red; los modelos se empaquetan en la app (aumento estimado de 40–70 MB, a medir).

## Referencias de mercado (información de los propios fabricantes, no verificada)
- **Jibble**: quiosco con reconocimiento facial, modo offline, prueba de vida contra imágenes estáticas (afirmación propia).
- **Truein**: fuentes contradictorias sobre modo offline; quiosco disponible.
- **Connecteam**: no se encontró información fiable sobre reconocimiento facial/offline.
Funcionalidades que aportan valor a Asistencia Tienda y que ya tenemos o planificamos: quiosco compartido, offline real, anti-suplantación, geocercas NO necesarias (teléfono fijo por tienda), reportes por jornada, alertas de intentos fallidos.

Fuentes: pypi.org/project/insightface · huggingface.co/Idiap/EdgeFace-Base · github.com/opencv/opencv_zoo (face_recognition_sface) · github.com/minivision-ai/Silent-Face-Anti-Spoofing · developers.google.com/edge/mediapipe/solutions/vision/face_landmarker · microsoft.com/en-us/research/publication/digiface-1m · jibble.io/best-software/facial-recognition-time-tracking-software · wappblaster.com/vs/truein

## Revisión 2026-11-20 (Fase 4) — selección vigente y por qué
**Combinación seleccionada (gratuita, ya integrada y funcionando en Android):**
MediaPipe Face Landmarker (detección + puntos + parpadeo) · SFace 128-d (reconocimiento) · MiniFASNet V2+V1SE (prueba pasiva)
· desafío activo (parpadeo o aleatorio) · ONNX Runtime Web + MediaPipe WASM como tiempo de ejecución.

Motivos: (1) todo corre sin red en la WebView con el **mismo código para Android e iOS** (no requiere módulos nativos por
plataforma); (2) es la única combinación encontrada con licencias de **código y pesos** que permiten al menos la validación
(los pesos de InsightFace/ArcFace y EdgeFace son no comerciales); (3) tamaño total ≈ 46 MB de modelos (SFace 38,7 MB,
MediaPipe 3,8 MB, MiniFASNet 2 × 1,7 MB), aceptable para un teléfono de tienda; (4) ya validada de extremo a extremo
(docs/RESULTADOS_PRUEBAS_BIOMETRICAS.md).

**Alternativas evaluadas y no adoptadas ahora:**
- *MobileFaceNet en TensorFlow Lite*: el obstáculo no es el formato (TFLite u ONNX) sino los **pesos**: los publicados
  están entrenados mayoritariamente con MS1M (retirado/no comercial) o sin procedencia. Cambiar de formato no resuelve la licencia.
- *Módulo nativo (Kotlin/Swift) con TFLite/ONNX Runtime Mobile*: más rápido en teléfonos de gama media, pero duplica el
  trabajo por plataforma. Se reconsiderará solo si las mediciones reales en el teléfono muestran tiempos inaceptables.
- *Google ML Kit*: detección gratuita y cerrada; no identifica personas.

**Limitaciones conocidas del motor gratuito:** procedencia de datos de SFace no verificada; licencia de pesos de MiniFASNet
no explícita (docs/LICENCIAS_BIOMETRICAS.md); prueba de vida no certificada; un vídeo de la persona puede superar el
desafío de parpadeo (por eso existe el modo aleatorio y la prueba pasiva); sin protección contra cámaras virtuales en
teléfonos rooteados ni deepfakes en tiempo real.

Fuentes adicionales: [SFace, arXiv 2205.12010](https://arxiv.org/abs/2205.12010) ·
[índice de pesos UniFace](https://huggingface.co/yakhyo/uniface-weights) · [face-antispoof-onnx](https://github.com/suriAI/face-antispoof-onnx)
