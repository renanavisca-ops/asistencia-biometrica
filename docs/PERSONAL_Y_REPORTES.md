# Módulos de personal: ciclo laboral, expediente, puntualidad, alertas y reportes

Ampliación del 2026-11-19 (migraciones `20261119001200`–`001230`). Todo es del panel administrativo: **nada de esto se
muestra en los teléfonos de las tiendas** (el teléfono solo recibe el roster de quién puede marcar).

## Administración de la plataforma (★ Plataforma)
- El dueño crea organizaciones (nombre, razón social, NIT, país, zona horaria, contacto, límites) e invita a su
  administrador principal (`platform_create_org` + Edge Function `admin-invite`). No queda como administrador ni ve sus datos.
- Las organizaciones siguen pudiendo registrarse solas desde la app. La organización propia se crea con «Mi propia organización».
- Límites validados en el servidor (triggers): empleados **vigentes** (activos + suspendidos; los dados de baja no consumen
  cupo), sucursales activas y teléfonos no retirados. Fecha de vencimiento: al vencer, solo lectura y sin marcación.
- Módulos por organización (`features`): `hr` (expedientes/disciplina), `schedules`, `alerts`, `reports`. Sin cobro integrado.

## Ciclo laboral
- Cada empleado tiene períodos laborales (`employment_periods`); la recontratación abre otro período con la misma identidad.
- Salida: tipo (renuncia, despido, fin de contrato, mutuo acuerdo, otra causa), fecha efectiva, motivo, comentarios,
  observaciones, quién y cuándo; documentos adjuntos en «Documentos». Fecha futura = baja programada (la aplica la tarea diaria).
- Efectos de la baja: inactivo, asignaciones terminadas, enrolamiento revocado (los teléfonos lo retiran al sincronizar),
  plantilla facial borrada a los 30 días (no al instante). Asistencia, expediente y disciplina se conservan.
- Suspensión temporal y reintegro quedan como eventos laborales. La vía antigua `set_employee_status` pasa por estas funciones.

## Expediente y disciplina
- Registros disciplinarios y reconocimientos con categoría (catálogo por organización), medida, descripción, comentarios,
  si se informó al empleado, estado (pendiente, en revisión, comunicado, resuelto, cerrado) y seguimientos.
- Sin borrado: un registro erróneo se **anula** con motivo (solo administración central). Todo queda en auditoría.
- Sin sanciones ni cartas automáticas. Documentos en almacenamiento privado (`hr-documents`, 10 MB, enlaces de 5 minutos).
- El acceso de soporte del superadministrador **no** incluye expedientes ni reportes de personal.

## Puntualidad
- Horarios **opcionales** por sucursal o por empleado, por día de la semana, con tolerancia, vigencia (cambios temporales)
  y excepciones (día libre, permiso, horario especial). Prioridad: excepción del empleado › de la sucursal › horario del
  empleado › de la sucursal. Sin horario no se evalúa nada.
- Tardanza = primera ENTRADA vigente aceptada dentro de [inicio − 4 h, inicio + 12 h) posterior a inicio + tolerancia;
  una por jornada. Minutos tarde = desde la hora programada. «Sin marcación» = jornada con horario sin entrada, registrada
  solo 12 h después del inicio; requiere revisión (no es ausencia injustificada).
- Zona horaria de la sucursal. Turnos nocturnos: la ventana de 12 h cruza la medianoche.
- Recalcula sola al ingerir marcaciones (incluidas las offline que llegan tarde) y al aplicar correcciones; las
  marcaciones en revisión no cuentan hasta confirmarse. Botón «Recalcular» en Horarios tras cambiar horarios.

## Alertas
- Una alerta por empleado y mes calendario al alcanzar el umbral (3 por defecto, configurable); la 4.ª tardanza actualiza
  la misma alerta (historial «conteo actualizado»). Correcciones que bajan el conteo también quedan en el historial.
- Acciones: comentar, marcar revisada, descartar (con justificación), cerrar, reabrir. Desde la alerta se abre el
  expediente para registrar una medida si corresponde. Estructura preparada para otros tipos (`alerts.kind`).

## Reportes (método)
- **Rotación** (toda la organización): por mes, plantilla inicial = períodos vigentes el día 1; final = vigentes el último
  día; altas = períodos iniciados en el mes (incluye recontrataciones); bajas = períodos terminados en el mes;
  rotación % = bajas / ((inicial + final) / 2) × 100; voluntarias = renuncias. Rotación del período = bajas totales /
  plantilla promedio mensual × 100.
- **Puntualidad**: por empleado, tardanzas, minutos totales, promedio, máximo y días sin marcación (filtro por sucursal).
- **Disciplina**: registros del período; los anulados se listan pero no se cuentan.
- Exportación a Excel (.xlsx, con hoja «Resumen» y notas del método) y CSV (UTF-8, protegido contra inyección de fórmulas).
  Requiere el permiso `report.run` (administración central y auditor).

## Roles
| Permiso | Admin. central | Supervisor (sus sucursales) | Auditor |
|---|---|---|---|
| Ver expediente (`hr.read`) | ✓ | ✓ | ✓ |
| Bajas, recontratación, documentos (`employee.manage`, `hr.manage`) | ✓ | — | — |
| Registrar llamadas de atención (`discipline.record`) | ✓ | ✓ | — |
| Anular registros (`discipline.manage`) | ✓ | — | — |
| Horarios (`schedule.manage`) | ✓ | — | — |
| Alertas: ver / gestionar | ✓ / ✓ | ✓ / ✓ | ✓ / — |
| Reportes (`report.run`) | ✓ | — | ✓ |

## Tareas programadas (pg_cron)
- `purge-deleted-orgs` 03:15 UTC.
- `hr-daily-maintenance` 06:20 UTC: aplica bajas programadas, borra plantillas revocadas hace más de 30 días y recalcula
  los últimos 2 días (para registrar «sin marcación»).

## Pendientes conocidos
- Al purgar una organización eliminada (90 días) los archivos de `hr-documents` deben borrarse con la API de Storage (no desde SQL).
- Si falla el registro de un documento tras subirlo, el archivo queda huérfano (no hay política de borrado en Storage).
- Notificaciones de alertas por correo: estructura (`notify_admin_ids`) lista, sin envío.
