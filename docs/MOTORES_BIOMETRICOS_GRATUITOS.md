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
