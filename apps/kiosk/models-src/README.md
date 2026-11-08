# Modelos de prueba de vida (pasiva) — EXPERIMENTAL

`minifasnet_v2_2.7.onnx` y `minifasnet_v1se_4.0.onnx` son conversiones a ONNX de los pesos publicados en
https://github.com/minivision-ai/Silent-Face-Anti-Spoofing (licencia Apache-2.0, ver LICENSE-Silent-Face-Anti-Spoofing;
Copyright Minivision). Modificación: solo cambio de formato (PyTorch → ONNX, opset 13), sin reentrenar.

Reproducción: `tools/convert_minifasnet.py` (PyTorch 2.15 CPU). Verificación de paridad: diferencia máxima de softmax
frente a PyTorch 1.2e-7 en 5 entradas aleatorias por modelo.

Preprocesado (igual que el original): recorte cuadrado alrededor de la caja del rostro a escala 2,7 y 4,0, 80×80, **BGR**,
valores 0–255 sin normalizar; salida softmax de 3 clases, clase 1 = real; se promedian ambos modelos.

Limitaciones (del autor y nuestras): no certificado (ISO 30107-3/iBeta); robustez variable entre cámaras y escenas; la licencia de
los datos de entrenamiento no está documentada → uso EXPERIMENTAL hasta revisión.
