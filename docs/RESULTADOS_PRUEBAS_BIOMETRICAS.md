# Resultados de pruebas biométricas

> Motor gratuito **EXPERIMENTAL**: SFace (sface@2021dec) + MediaPipe Face Landmarker + MiniFASNet V2/V1SE + desafío activo.
> Nada de lo aquí descrito es una certificación (ISO/IEC 30107-3, iBeta). No se publican porcentajes sin su tamaño de muestra.

Las pruebas se separan en tres niveles; **solo el nivel 3 mide precisión real** y está pendiente de que el propietario
haga las sesiones con personas en la tienda.

## Nivel 1 — Pruebas unitarias (lógica, sin cámara)
| Prueba | Resultado (2026-11-20) |
|---|---|
| Comparación 1:N, umbral, margen, modelos incompatibles (`packages/core`) | ✅ (22 pruebas de la app de tienda) |
| Desafío activo: parpadeo abierto→cerrado→abierto; imagen estática nunca cumple; giro al lado contrario no cumple | ✅ |
| Métricas: FRR, FAR, identificación errónea, APCER (excluye intentos terminados por tiempo), BPCER, intervalo de Wilson (0 de 10 → IC hasta 27,8 %), barridos de umbral (`apps/admin/test/biometricMetrics.test.ts`) | ✅ 3 pruebas |
| Conversión MiniFASNet a ONNX vs PyTorch original | diferencia máxima 1,2e-7 |

## Nivel 2 — Integración con el motor real (Chromium sin interfaz en servidor; cámara simulada con fotos reales)
Mismo motor (WASM) que la WebView de Android, pero **en un servidor, no en un teléfono**: los tiempos NO representan el teléfono.
Script: `scripts/test-face-e2e.sh` (app compilada → device-api → Postgres con las migraciones reales).

| Escenario (2026-11-20) | Resultado |
|---|---|
| Foto estática con desafío de parpadeo | ✅ rechazada («Verificación no superada»), sin marcación |
| Foto estática con desafío **aleatorio** (política 2) | ✅ rechazada, sin marcación |
| Persona A enrolada (solo pasiva) | ✅ reconocida sin selección manual, ENTRADA sincronizada, similitud 0,988 |
| Persona B enrolada (solo pasiva) | ✅ reconocida (no confundida con A), similitud 0,992 |
| Persona no enrolada | ✅ «No reconocido», sin marcación |
| Umbral pasivo imposible | ✅ prueba de vida fallida |
| Sin umbrales publicados | ✅ «sin calibrar», nadie es reconocido |
| **Modo validación**: persona enrolada + foto estática como ataque + medición 1:N | ✅ A reconocida (0,988; 2.º candidato 0,086), foto detenida por el desafío, 3 intentos guardados en el servidor, **0 marcaciones** creadas |

Tiempos medidos en el servidor (referencia, no teléfono): reconocimiento total 2,1 s · detección 813 ms/fotograma · embedding
55 ms · prueba pasiva 15 ms. Búsqueda 1:N (3 plantillas por empleado): 10 → 0,03 ms · 100 → 0,08 ms · 500 → 1,0 ms ·
1.000 → 1,8 ms · 5.000 → 5,7 ms (la comparación no es el cuello de botella; lo es la detección).

**Limitación:** las plantillas y la cámara usan la misma foto; demuestra que la cadena funciona, no su exactitud entre
capturas distintas de la misma persona.

## Nivel 3 — Validación real con personas y el teléfono de la tienda
### Datos reales disponibles hoy
| Fuente | n | Resultado |
|---|---|---|
| Marcación real de empleada enrolada (HONOR, tienda, 2026-11-09) | 1 | ✅ Reconocimiento correcto: similitud 0,764, margen 0,445, pasiva 0,940, desafío parpadeo |
| **Persona NO enrolada** (hombre, Samsung SM-S721B, 2026-11-20) | 1 | ❌ **Aceptado como una empleada** (similitud 0,538, margen 0,10) con los umbrales provisionales 0,40 / 0,08 |
| Comparación entre las 27 plantillas enroladas (3 personas × 9) | 27 sondas propias, 54 ajenas | Misma persona: promedio 0,886 (mín. 0,41 por una muestra mala); personas distintas: promedio 0,290, **máximo 0,465** |

**Corrección aplicada (2026-11-20, app 0.7.1 y política v2):** umbral 0,62 y margen 0,12 (por encima del máximo medido entre
personas distintas y del caso aceptado por error); la puntuación de cada persona es el **promedio de sus 3 plantillas más
parecidas** (antes la mejor sola, lo que dejaba coincidir con una muestra mala o de perfil); **doble confirmación** (las
capturas antes y después del desafío deben identificar por separado a la misma persona); y en el enrolamiento las muestras
de frente deben tener consistencia ≥ 0,70 (antes 0,50). Una de las empleadas (Astri) tiene 2 plantillas de baja calidad: se
recomienda reenrolarla. Con n tan pequeño **no se puede calcular ninguna tasa** (FRR, FAR, APCER, BPCER). La Fase 4 no se declara terminada.

### Cómo se mide (herramienta lista en la app 0.7.0 y el panel)
1. En el teléfono de la tienda: mantener presionado 3 s el pie de pantalla → **Validación biométrica**. Este modo ejecuta la
   misma cadena que la marcación pero **no registra asistencia** ni guarda fotos.
2. Para cada intento elegir la condición (persona enrolada y quién es, persona no enrolada, foto impresa, foto en pantalla,
   vídeo en pantalla, otro), la luz y la prueba de vida (parpadeo, aleatoria o solo pasiva) y tocar «Iniciar intento».
3. «Enviar resultados» (funciona sin internet: quedan guardados cifrados y se envían después).
4. Panel → **Validación biométrica**: FRR, identificación errónea, FAR, BPCER, APCER por tipo de ataque, «ataques que
   lograron marcar», tiempos (mediana y p95), memoria, batería, barridos de umbral para calibrar y la búsqueda 1:N medida
   en el teléfono. Cada tasa se muestra como «k de n · % (IC 95 %)».

### Protocolo mínimo recomendado (solo con personas que acepten participar)
| Bloque | Cantidad | Mide |
|---|---|---|
| Personas enroladas, luz normal | ≥ 10 personas × 10 intentos | FRR, identificación errónea, tiempos |
| Las mismas con poca luz / contraluz / lentes o gorra | 5 intentos por condición | robustez |
| Personas **no** enroladas | ≥ 5 personas × 10 intentos | FAR |
| Foto impresa de un empleado enrolado (papel normal y fotográfico) | ≥ 20 intentos | APCER impresa |
| Foto en otra pantalla (teléfono o tablet) | ≥ 20 intentos | APCER pantalla |
| Vídeo del empleado parpadeando / girando en otra pantalla | ≥ 20 con parpadeo y ≥ 20 con aleatoria | APCER vídeo (riesgo conocido) |
| Repeticiones rápidas de la misma persona | 10 | anti-doble marcación |
| «Medir 1:N» y una sesión dejando la app abierta varias horas | 1 al inicio y 1 al final | rendimiento y batería |

Con 0 errores en 100 intentos, el límite superior del IC 95 % es ≈ 3,7 %: para afirmar tasas bajas se necesitan cientos de
intentos. Las cifras describen solo a las personas, teléfonos y condiciones probados.

### Ataques: qué detecta y qué no (según el diseño; pendiente de medir en el teléfono)
| Ataque | Mecanismo que debería detenerlo | Estado |
|---|---|---|
| Foto impresa / foto en pantalla | Desafío activo (una imagen estática no parpadea ni gira) + pasiva | Detenido en nivel 2 con imagen estática; falta medir con papel y pantallas reales |
| Vídeo del empleado parpadeando | Solo la prueba pasiva (el vídeo cumple el parpadeo); el desafío aleatorio exige además un giro en el sentido pedido | **Riesgo conocido**; medir APCER con vídeo |
| Máscara 3D de calidad, deepfake en tiempo real, cámara virtual en teléfono rooteado | No cubierto por el motor gratuito | No protegido |
| Intentos repetidos con imágenes malas | Enfriamiento tras fallos consecutivos (`maxFailedAttempts`, `cooldownSec`) | Implementado |
