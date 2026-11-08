# Pruebas de prueba de vida (anti-suplantación / PAD)

> Mecanismos: **pasivo** MiniFASNet V2 + V1SE (Silent-Face, Apache-2.0, convertido a ONNX por nosotros) + **desafío activo aleatorio**
> (parpadeo / giro a la izquierda / giro a la derecha, MediaPipe) + **continuidad de identidad** (la misma persona antes y después del desafío).
> Todo **EXPERIMENTAL y no certificado** (ISO/IEC 30107-3, iBeta). No protege contra deepfakes en tiempo real, inyección de cámara
> virtual en teléfonos rooteados ni máscaras 3D de calidad. Ningún resultado de este documento convierte el sistema en apto para producción.

## Cómo decide la app
1. Rostro frontal con calidad → identidad A + puntuación pasiva.
2. Desafío aleatorio (si `activeChallenge = 1`, por defecto) con tiempo límite (`challengeTimeoutSec`, 8 s).
3. Vuelta de frente → identidad B + puntuación pasiva.
4. Se rechaza si: el desafío no se cumple, A y B no son la misma persona, o la media pasiva < `padThreshold`.
5. Sin umbrales publicados (`matchThreshold`, `matchMargin`, `padThreshold`) el teléfono **no reconoce a nadie**.
6. Fallos consecutivos → enfriamiento (`maxFailedAttempts`, `cooldownSec`); los conteos se envían al servidor en el informe de salud (`pad_fail_*`, `not_recognized`, `cooldown`).

## 2026-11-08 — Etapa 2: pruebas automatizadas (servidor, no teléfono)
| Prueba | Resultado |
|---|---|
| Conversión ONNX vs PyTorch original | diferencia máxima de softmax 1,2e-7 (paridad exacta) |
| Lógica del desafío (unitarias) | parpadeo abierto→cerrado→abierto ✅; imagen estática nunca cumple ✅; giro al lado contrario NO cumple ✅ |
| E2E: imagen estática frente a la cámara con desafío activo | **rechazada** («Verificación no superada»), sin marcación |
| E2E: umbral pasivo no alcanzado | rechazada, sin marcación |
| E2E: sin umbrales | «sin calibrar», sin marcación |
| Puntuación pasiva en retratos digitales (no refotografiados) | ≈0,99 «real» — esperado; **no** demuestra detección de ataques |

**Lo que NO se ha probado todavía:** fotos impresas, fotos en pantallas y vídeos reales delante de la cámara del teléfono. Eso solo puede medirse físicamente.

## Protocolo de prueba en el teléfono (pendiente de ejecutar)
Usar **Diagnóstico del motor** (estado del encargado → pulsación larga 3 s en el pie de pantalla). No guarda imágenes.
Para cada condición, 10 capturas, anotando «REAL (pasiva)» y si «Probar desafío» se cumple:
| Condición | Esperado |
|---|---|
| Persona real, buena luz | pasiva alta; desafío cumplido |
| Persona real, poca luz / contraluz | registrar (puede bajar) |
| Foto impresa (papel normal y fotográfico) | pasiva baja; desafío no cumplido |
| Foto en pantalla de otro teléfono / tablet | pasiva baja; desafío no cumplido |
| Vídeo de la persona parpadeando/girando en otra pantalla | **riesgo conocido**: puede cumplir el desafío; la pasiva debe detectarlo |
| Persona real con lentes / gorra | registrar |
Métricas a publicar: APCER por tipo de ataque y BPCER (personas reales rechazadas), con el número de intentos. **No se publican porcentajes sin estas mediciones.**
