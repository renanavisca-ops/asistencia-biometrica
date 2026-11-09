# Plataforma, organizaciones y planes

## Roles
- **Superadministrador (dueño de la plataforma):** página «★ Plataforma» del panel. Ve por organización solo cifras de uso
  (empleados, empleados con rostro, sucursales, teléfonos, marcaciones de 30 días, última actividad), contactos de sus
  administradores, plan y estado. Puede asignar plan / «pagado hasta» / «sin límite», suspender y reactivar. **No ve ni
  modifica datos de una organización** (RLS: `has_org_perm`, `has_store_perm`, `store_ids_with`, `is_org_member` ya no
  conceden nada al rol `superadmin`). Excepción: **acceso de soporte** temporal (1–72 h) y de solo lectura que la
  organización concede en «Privacidad y cuenta» (`support_access`, auditado).
- **Administrador central:** administra su organización (sucursales, empleados, teléfonos, permiso de enrolamiento por
  teléfono, administradores, privacidad, descarga de datos, eliminación de la cuenta).

## Alta de organizaciones
Desde la app: «Crear mi organización» (nombre, país, nombre, correo, contraseña, aceptación de términos `TERMS_VERSION`).
Supabase Auth crea la cuenta y envía el correo de confirmación (redirige a `/auth/confirmed` del panel). En el primer
inicio de sesión del panel, `complete_signup()` crea la organización (con su región/zona horaria) y la cuenta de
administrador central; después se configura el autenticador (MFA obligatorio).
El superadministrador puede crear su **organización propia sin límite** (`platform_create_own_org`).

## Planes (empleados con rostro registrado)
1–5 gratis · 6–10 · 11–20 · 21–30 · 31–50 · 51–100 · 101–150 · … (de 50 en 50).
- 80 % del límite: aviso. Límite alcanzado: aviso y `enroll_biometric` rechaza nuevos rostros (reenrolar no cuenta).
- Plan de pago con «pagado hasta»: aviso 7 días antes; al vencer, la organización queda en **solo lectura** y los
  teléfonos **dejan de marcar** (`org_access = 'read_only'`; la app rechaza con `org_inactive` y el servidor marca en
  revisión cualquier evento que llegue).
- Suspensión manual: igual que vencida. Cobro: manual por ahora (sin pasarela de pago).

## Eliminación de la cuenta
`request_org_deletion` (escribiendo el nombre de la organización): solo lectura, teléfonos detenidos, datos conservados
**90 días**; `cancel_org_deletion` o reactivación del superadministrador lo revierten. La tarea diaria `pg_cron`
`purge-deleted-orgs` (03:15 UTC) ejecuta `private.purge_due_orgs()` y borra todo (incluidas las cuentas de administrador
que ya no pertenezcan a otra organización).

## Términos
`packages/core/src/legal.ts` (versión `v1-2026-11`, **borrador a revisar con abogado**): los datos son de la organización;
la plataforma no es un servicio de conservación de registros ni garantiza plazos legales; limitación de responsabilidad;
planes; 90 días tras la cancelación; acceso de soporte solo con permiso. Se muestran en la app y en `/terminos`.

## Configuración pendiente en Supabase (la hace el propietario; no se comparten claves en el chat)
1. **Authentication → Sign In / Providers → Email:** permitir registros nuevos y exigir confirmación de correo.
2. **Authentication → SMTP Settings:** servidor de Resend (host `smtp.resend.com`, puerto 465, usuario `resend`,
   contraseña = clave de API de Resend) y remitente de un dominio verificado en Resend.
3. **Authentication → URL Configuration:** Site URL `https://asistencia-biometrica.vercel.app`; Redirect URLs:
   `https://asistencia-biometrica.vercel.app/auth/confirmed` y `https://asistencia-biometrica.vercel.app/auth/accept`.
