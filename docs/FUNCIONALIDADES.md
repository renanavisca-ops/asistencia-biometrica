# Asistencia Tienda — Qué hace la aplicación hoy

> Estado al 20 de noviembre de 2026. Panel web: https://asistencia-biometrica.vercel.app · App de tienda (Android): versión **0.7.0**.
> Marcado **(experimental)** = funciona, pero no está validado para uso laboral real (ver «Limitaciones» al final).

Asistencia Tienda es una plataforma para controlar la asistencia de empleados en tiendas con un **teléfono compartido**
que reconoce el rostro, funciona **sin internet** y sincroniza después. Tiene tres partes:

1. **App de tienda** (Android): el teléfono fijo en cada tienda donde los empleados marcan entrada y salida.
2. **Panel web de la organización**: donde cada empresa administra empleados, asistencia, horarios, expedientes y reportes.
3. **Mi plataforma**: el área del dueño del software para administrar las empresas clientes como negocio.

---

## 1. App de tienda (teléfono compartido)

### Activación y control del teléfono
- Se activa con un **código de un solo uso** emitido en el panel (Teléfonos). El teléfono genera su propia clave de
  seguridad (Ed25519) que nunca sale del aparato; cada envío al servidor va firmado.
- Una empresa nueva puede **registrarse desde la propia app** («Crear mi organización»): primeros 5 empleados gratis.
- El teléfono queda asignado a **una tienda** y solo reconoce a los empleados autorizados en ella.
- Si el panel **bloquea** el teléfono, este borra su lista de empleados y deja de marcar. Se puede **reactivar** con un
  código nuevo.
- Si la membresía de la empresa vence o se suspende, el teléfono **no permite marcar**.

### Marcación
- El empleado toca la pantalla y mira la cámara: **no escribe nombre, código ni elige** entrada o salida.
- La app reconoce el rostro, verifica que sea una persona real (prueba de vida) y decide sola si es **ENTRADA** o **SALIDA**.
- Al salir pregunta solo una cosa: **«Salida a almuerzo»** o **«Fin de turno»**. Al volver del almuerzo registra el regreso.
- Saludo con el nombre y según el género («Bienvenida/Bienvenido»); al salir muestra el tiempo trabajado.
- Protecciones: **anti doble marcación** (dos veces seguidas no alterna), confirmación si sale pocos minutos después de
  entrar, **pausa** tras varios intentos fallidos, rechazo de personas no autorizadas.

### Reconocimiento facial y prueba de vida (experimental)
- Todo ocurre **en el teléfono, sin internet**: detección (MediaPipe), reconocimiento (SFace) y prueba de vida
  (MiniFASNet + desafío activo).
- Prueba de vida configurable por empresa: **parpadeo** (vigente), **aleatoria** (parpadeo o giro de cabeza, más
  difícil de engañar con un vídeo) o solo pasiva.
- Sin umbrales de calibración publicados, el teléfono **no reconoce a nadie** (protección por diseño).

### Funcionamiento sin internet
- Las marcaciones se guardan en una **base local cifrada** (SQLCipher) y se envían cuando vuelve la conexión, **sin duplicar**.
- Protección contra **manipulación del reloj** del teléfono (se compara con la hora del servidor; las dudosas van a revisión).
- **Vigencia de autorización**: si el teléfono pasa demasiado tiempo sin sincronizar, deja de marcar (configurable).
- Altas, **bajas, traslados y revocaciones** se aplican en la siguiente sincronización (un empleado dado de baja deja de
  poder marcar; un traslado no requiere volver a registrar el rostro).

### Modos para el encargado o administrador (mantener presionado 3 s el pie de pantalla)
- **Estado del teléfono**: tienda, última sincronización, pendientes, personas autorizadas, versión de política, motor.
- **Enrolamiento (registro del rostro)**: solo en teléfonos autorizados en el panel y con autorización de un
  administrador. Guía de 6 pasos, verificación del documento de identidad, varias muestras con control de calidad,
  prueba de vida y comprobación de **rostros duplicados** en toda la empresa. No se guardan fotos, solo plantillas cifradas.
- **Diagnóstico del motor**: compara dos capturas y muestra similitud, calidad y tiempos.
- **Validación biométrica** (nuevo en 0.7.0): pruebas con personas y ataques (fotos, pantallas, vídeos) **sin registrar
  asistencia** ni guardar fotos; mide aciertos, rechazos, tiempos, memoria y batería, y envía los resultados al panel.

---

## 2. Panel de la organización (cada empresa)

Acceso con correo, contraseña y **verificación en dos pasos (MFA) obligatoria**. Cada empresa ve **solo sus datos**.

| Menú | Qué permite |
|---|---|
| **Inicio** | Indicadores del día; **Personal ahora** (quién está en turno, en almuerzo o salió); indicadores del mes de puntualidad, alertas, casos disciplinarios, altas, bajas y rotación (filtrables por mes y tienda); teléfonos sin sincronizar. |
| **Asistencia** | Pestañas por tienda; **jornadas** (entrada, almuerzo, salida y horas trabajadas), sesiones y eventos; correcciones auditadas (confirmar, anular o agregar marcaciones con motivo); exportación CSV. |
| **Incidencias** | Salidas omitidas, conflictos offline, relojes anómalos, intentos de clonación de teléfono, etc.; resolución con comentario. |
| **Empleados** | Alta (código automático, documento cifrado, género para el saludo, tienda) y **expediente** de cada empleado (ver abajo). |
| **Horarios** | Horarios **opcionales** por tienda o por empleado, por día, con tolerancia, excepciones (día libre, permiso, horario especial) y cambios temporales. **Pestaña por tienda** con la vista de la semana y **carga desde Excel** (plantilla descargable con los empleados). Recalcular tardanzas. |
| **Alertas** | Alerta cuando un empleado llega tarde **3 o más veces en el mes** (umbral configurable): una por mes, se actualiza con cada nueva tardanza. Seguimiento: comentar, revisar, descartar con justificación, cerrar. **Avisos por correo** a los destinatarios elegidos (requiere configurar Resend). |
| **Disciplina** | Registro de llamadas de atención y reconocimientos de toda la empresa, con filtros. |
| **Reportes** | **Rotación** (método documentado), **puntualidad** y **disciplina**, exportables a **Excel y CSV**. |
| **Sucursales** | Regiones y tiendas (zona horaria, sede central). |
| **Teléfonos** | Alta de teléfonos, **códigos de activación**, permiso de enrolamiento, bloqueo y reactivación, estado de salud. |
| **Validación biométrica** | Resultados de las pruebas del modo validación: tasas de rechazo de empleados, aceptación de desconocidos, ataques detenidos y no detenidos (siempre con cantidad de pruebas e intervalo de confianza), tablas para calibrar umbrales, tiempos en el teléfono. |
| **Política offline** | Reglas de operación del teléfono: anti doble marcación, almuerzo, horas sin internet, vigencia, **umbrales biométricos** y tipo de prueba de vida. Versionada. |
| **Administradores y permisos** | Invitar administradores; roles: **administrador central**, **supervisor** (solo sus tiendas) y **auditor** (solo lectura); permiso especial **«ver motivos de baja»** para personas concretas. |
| **Privacidad y cuenta** | Conceder **acceso de soporte temporal** al proveedor (1 a 72 h, queda auditado); solicitudes de retención o borrado de datos; **eliminar la cuenta** (datos conservados 90 días). |
| **Auditoría** | Registro de todos los cambios administrativos (quién, cuándo, qué). |

### Expediente del empleado
- **Situación laboral**: alta, **suspensión** y reintegro, **baja** (renuncia, despido, fin de contrato, mutuo acuerdo u otra
  causa; fecha efectiva, motivo, comentarios; con fecha futura queda programada) y **recontratación** (nuevo período,
  misma identidad). Una baja revoca la autorización para marcar y libera el cupo; la plantilla facial se borra a los 30 días.
- **Historial laboral** completo de períodos y eventos. **Nada se borra.**
- **Motivos de baja reservados**: solo los ve la administración central o quien tenga el permiso especial.
- **Puntualidad**: tardanzas (minutos), días con horario sin marcación, correcciones, incidencias y alertas.
- **Disciplina y reconocimientos**: categoría, medida, descripción, si se informó al empleado, estado (pendiente, en
  revisión, comunicado, resuelto, cerrado) y seguimiento. Un error se **anula** con motivo, no se borra. Sin sanciones automáticas.
- **Documentos**: carga de archivos (contratos, cartas) en almacenamiento privado, con enlaces temporales.

### Lo que el teléfono de la tienda **nunca** muestra
Información disciplinaria, motivos de despido, documentos ni datos de otros empleados.

---

## 3. Mi plataforma (dueño del software)

Área separada, con su propio menú morado; se cambia entre plataforma y organizaciones con el **selector del menú**.

| Menú | Qué permite |
|---|---|
| **Resumen** | Organizaciones (activas, con uso, suspendidas o vencidas), empleados vigentes totales, marcaciones de 30 días, crecimiento de 12 meses, empresas cerca de su límite. Solo cifras agregadas. |
| **Organizaciones** | Crear empresas (datos, país, zona horaria, contacto) e invitar a su administrador; **límites** de empleados vigentes, tiendas y teléfonos (aplicados en el servidor); vencimiento; módulos habilitados; **aplicar un plan**; suspender o reactivar; crear la **organización propia**. |
| **Planes** | Catálogo de planes comerciales (límites, módulos, nota de precio). Sin cobro integrado. |
| **Auditoría de plataforma** | Acciones del dueño sobre organizaciones y planes. |

El dueño **no ve** expedientes, asistencia ni biometría de los clientes. Para soporte, la empresa le concede un acceso
temporal de **solo lectura** que queda registrado en la auditoría de esa empresa.

---

## 4. Procesos automáticos (servidor)
| Proceso | Frecuencia | Qué hace |
|---|---|---|
| Mantenimiento de personal | Diario 06:20 UTC | Aplica bajas programadas, borra plantillas revocadas hace más de 30 días, registra días sin marcación. |
| Trabajos en segundo plano | Cada 10 min | Envía correos de alertas pendientes y borra archivos encolados con la API oficial de Storage. |
| Archivos huérfanos | Diario 04:40 UTC | Encola archivos subidos sin registro con más de 24 h. |
| Borrado de cuentas eliminadas | Diario 03:15 UTC | Borra definitivamente las organizaciones eliminadas hace 90 días (incluidos sus archivos). |

## 5. Seguridad y privacidad
- Aislamiento entre empresas en la base de datos (políticas RLS); permisos validados en el servidor, no solo en pantalla.
- MFA obligatoria en el panel; teléfonos autenticados por firma; marcaciones firmadas e inmutables (las correcciones se agregan, no reemplazan).
- Documentos de identidad y plantillas faciales **cifrados**; no se guardan fotos de rostros.
- Auditoría de cambios, de accesos de soporte y de lecturas de documentos de identidad.
- Términos y condiciones aceptados por la empresa al registrarse.

## 6. Limitaciones actuales (importante)
- **Biometría experimental**: el motor gratuito no está validado con suficientes personas reales (hoy 1 marcación real).
  Los umbrales son provisionales. Hace falta ejecutar el **modo validación** en la tienda (docs/RESULTADOS_PRUEBAS_BIOMETRICAS.md).
- **Licencia comercial pendiente** de los modelos de reconocimiento y prueba de vida (docs/LICENCIAS_BIOMETRICAS.md).
- Prueba de vida **no certificada**: un vídeo puede superar el desafío de parpadeo; no protege contra máscaras ni deepfakes.
- **Correos de alertas**: requieren cargar las claves de Resend en Supabase.
- **iOS**: preparado pero no compilado ni probado.
- **Cobro**: no hay pagos integrados; los planes se aplican manualmente.
