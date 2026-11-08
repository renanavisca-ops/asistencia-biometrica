# App de tienda (apps/kiosk)

Capacitor 8 + React. Lógica de dominio en TypeScript puro (probada); infraestructura nativa mínima en Java.

## Capas
| Capa | Archivos | Estado |
|---|---|---|
| Dominio: activación, marcación, cola, sincronización, política | `src/domain/kiosk.ts`, `store.ts`, `http.ts` | ✅ 9 pruebas unitarias + 1 E2E (app ↔ Edge Function ↔ Postgres) |
| Almacenamiento cifrado | `src/infra/sqliteStore.ts` (SQLCipher vía @capacitor-community/sqlite; frase secreta aleatoria guardada por el plugin en Android Keystore / iOS Keychain) | ✅ Compila; ⏳ pendiente de verificar en un teléfono real |
| Reloj monotónico + contador de arranques | Plugin nativo `DeviceClockPlugin.java` (`SystemClock.elapsedRealtime`, `Settings.Global.BOOT_COUNT`) | ✅ Compila; ⏳ verificar en el teléfono |
| Modo quiosco básico | `FLAG_KEEP_SCREEN_ON`, `FLAG_SECURE` (sin capturas de pantalla), sin copias de seguridad en la nube (`allowBackup=false`, `data_extraction_rules`) | ✅ |
| Biometría | `src/infra/biometric/engine.ts`: interfaz `BiometricEngine`; hoy solo **motor SIMULADO** | ❌ **NO IMPLEMENTADO** |

## Flujo en pantalla
Inicio («Toque la pantalla») → cámara frontal + identificación → **ENTRADA/SALIDA REGISTRADA** con nombre y hora (4 s, configurable) → la cámara se apaga y se vuelve al inicio. «Ya registrado» si se repite dentro de la ventana anti-doble. Mensajes claros si la persona no está autorizada en la tienda, si la autorización caducó o si el teléfono lleva demasiado tiempo sin conexión.
Pulsación larga (3 s) en el pie de pantalla → estado para el encargado (última sincronización, pendientes, versión de política, motor biométrico, «Sincronizar ahora»). No permite ver ni editar marcaciones.

## Modo prueba (motor simulado)
Mientras la biometría no esté implementada, la app muestra un **aviso permanente «MODO PRUEBA — SIN BIOMETRÍA»** y, en la pantalla de cámara, una lista de las personas autorizadas de esa tienda para simular la identificación. Los eventos se envían con `recognitionModel = "SIMULADO@0"` y sin puntuaciones, de modo que el servidor y las exportaciones los distinguen. **Esta lista desaparece con el motor real**; nunca debe usarse en operación.

## Sincronización
Al iniciar, al volver a primer plano, al recuperar la red, tras cada marcación y cada 5 min; con fallos, backoff exponencial con jitter (5 s → 10 min). El `batchId` se persiste antes de enviar: si se corta la conexión o se cierra la app, el reintento usa el mismo lote y el servidor no duplica. Si el servidor bloquea el teléfono, se borra el roster local y se deja de marcar.

## Compilar
```bash
cd apps/kiosk
pnpm android:apk   # requiere Android SDK (ANDROID_HOME) y JDK 21
```
APK: `apps/kiosk/android/app/build/outputs/apk/debug/app-debug.apk`. El CI (`android-apk`) lo publica como artefacto en cada push a `main`.
Variable de compilación opcional: `VITE_DEVICE_API_URL` (por defecto, la Edge Function de producción).

## Pendiente
- Verificación en teléfonos reales: persistencia tras cierre forzado y reinicio, cifrado SQLCipher, cámara, consumo.
- Modo quiosco completo (Lock Task con el teléfono como *device owner*, o fijación de pantalla) y lanzamiento al arrancar.
- Clave Ed25519 dentro del hardware (Keystore) si el dispositivo lo soporta; hoy se guarda dentro de la base SQLCipher, cuya clave está protegida por Keystore.
- Play Integrity en la activación y la sincronización.
- Procedimiento supervisado para personas no reconocidas.
- iOS (requiere macOS + cuenta Apple Developer).
