# Biometría: reconocimiento 1:N y prueba de vida (PAD) offline

> **Estado: NO IMPLEMENTADO.** No hay modelo de reconocimiento ni de prueba de vida integrado ni validado.
> Ninguna parte de este sistema debe considerarse apta para producción hasta completar la Fase 4 con mediciones reales.

## Lo que ya existe (y lo que NO es)
| Pieza | Estado | Nota |
|---|---|---|
| Comparador 1:N de vectores (`packages/core/src/matching.ts`) | Hecho, probado | Solo compara embeddings; **no es biometría**. Sin umbrales calibrados devuelve `uncalibrated` y nunca acepta. |
| Almacenamiento cifrado de plantillas (Vault + pgp AES-256) | Hecho, probado | Plantillas versionadas por modelo; inaccesibles desde API/panel. |
| Enrolamiento central con reglas (`enroll_biometric`) | Hecho, probado | Exige sede central, consentimiento, PAD superado, 3–10 muestras y dimensión correcta. |
| Detección de rostro, calidad, embeddings, PAD en el teléfono | **NO IMPLEMENTADO** | Fase 4. |
| Captura de enrolamiento en sede central | **NO IMPLEMENTADO** | Debe usar el **mismo modelo** que los teléfonos (recomendado: la propia app en "modo enrolamiento" operada por un administrador). |

## Aclaraciones que condicionan el diseño
- **Google ML Kit** detecta rostros y puntos faciales; **no identifica personas ni es prueba de vida**.
- **Face ID / BiometricPrompt** autentican al dueño del teléfono; **no identifican a distintos empleados** en un teléfono compartido.
- Parpadeo o giro de cabeza **no** bastan como PAD: un vídeo los reproduce.
- Las métricas de los proveedores son autodeclaradas hasta verificarlas en los listados de iBeta y con pruebas propias.

## Matriz comparativa (investigación 2026-11-08; verificar antes de decidir)
| Opción | Tipo | Offline Android+iOS | 1:N | PAD | Licencia comercial | Coste | Observaciones |
|---|---|---|---|---|---|---|---|
| InsightFace `buffalo_l` (ArcFace) | Open weights | Sí (ONNX) | Sí | No | **No**: pesos solo para investigación no comercial; licencia aparte bajo pedido | Cotización | Muy preciso, pero no utilizable comercialmente sin licencia |
| EdgeFace (Idiap) | Open weights | Sí | Sí | No | **No** (CC BY-NC-SA 4.0) | — | Pensado para dispositivos, pero no comercial |
| OpenCV Zoo **SFace** + **YuNet** | Open weights | Sí (ONNX/OpenCV) | Sí | No | **Sí**: Apache-2.0 (SFace), MIT (YuNet) según el repositorio | 0 | **Candidato para prototipo**. Pendiente: procedencia del conjunto de entrenamiento y precisión propia |
| Silent-Face-Anti-Spoofing (Minivision) | Open weights | Android probado por el autor | — | Pasivo RGB | Etiqueta Apache-2.0 en el repo; **no aclara los pesos** | 0 | Sin certificación. El propio autor advierte de baja robustez entre cámaras/escenas. Solo para pruebas internas |
| Regula Face SDK | Comercial | Sí | Sí | Activo y pasivo; dice iBeta L1/L2 | Sí | Cotización | Verificar alcance on-device del 1:N y listado iBeta |
| FaceOnLive | Comercial | Sí | Sí | Pasivo; dice iBeta L2 | Sí, clave offline por dispositivo | Cotización | Licencia por dispositivo encaja con "un teléfono por tienda" |
| Identy | Comercial | Sí | Verificar | Dice iBeta L1/L2 | Sí | Cotización | Orientado a eKYC; confirmar 1:N local |
| Innovatrics DOT, ID R&D IDLive, FacetagR, FacePlugin | Comercial | Según proveedor | Variable | Variable | Sí | Cotización | Pedir informe iBeta y términos |

**Recomendación (vía doble aprobada):**
1. **Prototipo interno:** YuNet (detección) + SFace (embeddings) + Silent-Face (PAD), ejecutados con ONNX Runtime Mobile o TFLite mediante módulos nativos Kotlin/Swift. Marcado **NO APTO PARA PRODUCCIÓN**. Sirve para validar el flujo extremo a extremo, la latencia y la calibración.
2. **Producción:** pedir a 2–3 proveedores (p. ej. Regula, FaceOnLive, Innovatrics) el informe iBeta, el precio para N teléfonos, si hay 1:N on-device sin servidor, la extracción de plantillas en la sede central compatible con los teléfonos, y los términos de redistribución. **Ningún pago se incorpora sin tu autorización.**

## Protocolo de validación (Fase 4, obligatorio antes de producción)
- **Exactitud 1:N:** galería de cada tienda (tamaño real por sede) con sujetos enrolados y no enrolados. Reportar FPIR/FNIR (tasas de identificación falsa positiva y falsa negativa) con intervalos de confianza al 95 % (Clopper-Pearson), indicando el tamaño de muestra. Desglosar por iluminación, lentes, mascarilla, tono de piel, edad y modelo de teléfono. **No se publica ningún porcentaje sin estas mediciones.**
- **PAD:** fotos impresas, pantallas de teléfono y tablet, vídeo, máscaras de papel. Reportar APCER y BPCER por tipo de ataque, siguiendo la metodología de ISO/IEC 30107-3.
- **Amenazas fuera del alcance de una app RGB:** deepfakes en tiempo real e inyección de cámara virtual en teléfonos rooteados. Mitigaciones: integridad del dispositivo (Play Integrity / App Attest al sincronizar), detección de root/jailbreak y teléfono bajo custodia del encargado de la tienda. No se promete protección absoluta.
- **Calibración:** los umbrales (`matchThreshold`, `matchMargin`, `padThreshold`) se publican por organización desde el panel (Política offline) solo con evidencia.
- **Rendimiento por modelo de teléfono:** latencia de punta a punta, consumo, temperatura y almacenamiento. Define la matriz de dispositivos soportados.

## Fuentes consultadas
- InsightFace (pesos no comerciales): https://pypi.org/project/insightface/ · https://www.insightface.ai/blog/commercial-licensing-for-insightface-models-what-enterprise-teams-should-know
- EdgeFace (CC BY-NC-SA 4.0): https://huggingface.co/Idiap/EdgeFace-Base
- OpenCV Zoo SFace (Apache-2.0): https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface
- Silent-Face-Anti-Spoofing: https://github.com/minivision-ai/Silent-Face-Anti-Spoofing
- Regula: https://regulaforensics.com/products/face-recognition-sdk/ · FaceOnLive: https://faceonlive.com/ · Identy: https://www.identy.io/facial-recognition-sdk/
- Innovatrics iBeta: https://www.biometricupdate.com/202010/innovatrics-passive-liveness-biometrics-excels-in-ibeta-presentation-attack-detection-test
