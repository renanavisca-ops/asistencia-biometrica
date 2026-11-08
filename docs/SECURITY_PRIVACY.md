# Seguridad y privacidad

## Roles (RBAC)
| Rol | Ámbito | Puede |
|---|---|---|
| Superadministrador | Plataforma | Todo, incluidas las organizaciones y los modelos |
| Administrador central | Organización | Sedes, empleados, enrolamiento, asignaciones, teléfonos, correcciones, privacidad, roles (salvo superadmin) |
| Supervisor | Tienda(s) o región | Ver su ámbito, resolver incidencias, excepciones supervisadas (sin corregir marcaciones) |
| Auditor | Organización/tienda | Solo lectura + auditoría + exportación |
| Teléfono de tienda | Su tienda | Solo `device-api`: marcar y descargar su roster. Sin acceso a tablas |

Los empleados **no tienen cuenta** ni ninguna vía para consultar o modificar datos.

## Controles implementados y probados
- RLS en **todas** las tablas (`force row level security`); el ámbito se deduce de `auth.uid()`, nunca de parámetros del cliente. Las claves foráneas compuestas impiden referencias entre organizaciones; `organization_id` es inmutable.
- MFA (TOTP) obligatorio: sin `aal2`, las políticas no devuelven datos aunque haya sesión.
- Marcaciones inmutables (ni siquiera `service_role` las edita o borra); correcciones con justificación ≥10 caracteres, actor, valores anteriores y nuevos; auditoría genérica de los cambios administrativos.
- Separación de funciones: nadie modifica sus propios roles; quien solicita un borrado de privacidad no puede aprobarlo.
- Plantillas: esquema `private`, cifrado AES-256 con clave en Vault, nunca expuestas al panel.
- Teléfonos: código de un solo uso (solo se guarda su hash; 30 min), prueba de posesión de la clave, desafíos de un solo uso (2 min) y freno global ante la fuerza bruta en la activación.
- Panel: cabeceras de seguridad (HSTS, X-Frame-Options DENY, nosniff), sin `service_role`, exportación CSV protegida contra inyección de fórmulas.

## Pendiente / riesgos aceptados por ahora
- Clave privada del teléfono en Keystore/Keychain (Fase 3); el core la soporta como cadena, la custodia nativa está pendiente.
- Play Integrity / App Attest en la activación y la sincronización (no pueden exigirse por marcación offline).
- Limitación de frecuencia por IP en `device-api` (hoy solo hay freno global de activación).
- Rotación de `template_enc_key` (requiere re-cifrar las plantillas; procedimiento por definir).
- **No hay protección absoluta** frente a un teléfono comprometido con root o frente a un administrador malicioso con permisos legítimos; la auditoría permite detectarlo, no impedirlo.

## Privacidad y cumplimiento (pendiente de revisión legal por país)
- Los datos biométricos son **datos sensibles** en Centroamérica. El sistema exige registrar el consentimiento (base legal, versión del aviso, fecha, referencia del documento) antes de enrolar, y permite retirarlo.
- Minimización: no se guardan fotos; solo embeddings cifrados. El teléfono recibe el nombre abreviado. No se guarda el documento completo (solo los últimos 4 caracteres).
- Derechos del titular: solicitud → aprobación por otra persona → borrado efectivo de plantillas y orden de borrado en los teléfonos.
- Alternativa no biométrica: se requiere un **procedimiento supervisado** (pendiente, `source = supervised_exception`) para quien no pueda o no quiera usar biometría.
- Antes de operar: evaluación de impacto, aviso de privacidad por país, plazos de retención de marcaciones según la ley laboral local y contrato de encargado de tratamiento con Supabase y Vercel. **Esto no es asesoría legal.**
