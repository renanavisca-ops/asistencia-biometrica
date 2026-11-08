# Offline-first y sincronización

## Flujo en el teléfono (Fase 3 implementará la app; el protocolo y el servidor ya existen)
1. Reconocimiento + PAD **locales** → empleado identificado en la galería de la tienda.
2. `decideNextEvent` (core): sin sesión abierta → ENTRADA; con sesión abierta → SALIDA; reconocimiento repetido dentro de la ventana anti-doble (120 s por defecto) → **no registra nada**; sesión abierta más de `staleSessionHours` (20 h) → ENTRADA + incidencia «salida omitida», **sin inventar** la salida. No hay cierre a medianoche.
3. Transacción local en SQLite cifrado: evento con UUID, `deviceSeq` creciente, hora de pared, reloj monotónico + `bootId`, última hora de servidor, desfase estimado y banderas de reloj; firmado con Ed25519.
4. Cola persistente → `POST /device-api/push` en lotes de ≤200 con `batchId` estable para los reintentos.

## Estados de un evento
| Estado | Significado |
|---|---|
| `pendiente` (local) | Guardado y firmado en el teléfono; **no** se muestra como sincronizado. |
| `accepted` | El servidor lo validó. |
| `duplicate` | Ya existía (reintento): no hay doble registro. |
| `needs_review` | Guardado, pero con incidencia: sede no asignada, empleado inactivo, reloj dudoso, alternancia inconsistente o tienda distinta. |
| `rejected` | Firma inválida, empleado de otra organización, secuencia reutilizada (posible clon) o id en conflicto. |

## Idempotencia y conflictos (probado)
- Reenviar el mismo lote devuelve los mismos acuses; el mismo evento en otro lote → `duplicate`.
- Misma `deviceSeq` con otro id → rechazo + incidencia `sequence_conflict` (alta) + evento de seguridad.
- Marcaciones contradictorias desde dos teléfonos sin conexión → ambas se guardan; la segunda queda `needs_review` + incidencia `offline_conflict`. **Nunca se sobrescribe en silencio.**
- Hueco de secuencia → incidencia `sequence_gap` (posibles eventos perdidos por reinstalación o corrupción).
- Tras una reinstalación administrada, la activación devuelve `nextDeviceSeq` para no reutilizar números.

## Reloj
No se promete hora exacta durante desconexiones. `assessClock` usa el reloj monotónico desde la última hora de servidor (inmune a cambios manuales de hora) y marca `clock_regression`, `clock_jump_forward`, `timezone_changed`, `reboot_since_server_sync`, `stale_server_time` y `no_server_time`. El servidor además marca eventos con hora futura (>5 min) o anterior a la activación. Todo evento con bandera va a revisión.

## Revocación offline: el equilibrio
Un teléfono desconectado **no conoce** altas, bajas ni traslados hasta sincronizar. Mitigaciones configurables por organización (panel → Política offline):
- `leaseHours` (168 h por defecto): cada empleado del roster caduca en el teléfono si no se renueva. Un valor más corto revoca antes, pero puede impedir marcar a empleados legítimos si la tienda pasa días sin internet.
- `offlineMaxHours` (72 h): tras ese tiempo sin sincronizar, el teléfono deja de marcar (0 = solo alerta).
- En el servidor, una marcación de un empleado revocado o trasladado nunca se pierde: entra como `needs_review` con incidencia `unassigned_store` o `inactive_employee`.
- El bloqueo de un teléfono es inmediato en el servidor: no obtiene desafíos y en su próxima conexión recibe la orden de borrar todos los datos locales.

## Pendiente (Fase 3/5)
Cola con *backoff* exponencial con *jitter*, reanudación tras cierre o reinicio, purga segura de plantillas revocadas, recuperación ante corrupción de SQLite (reactivación administrada) y pruebas de cierre forzado y reinicio en dispositivos reales.
