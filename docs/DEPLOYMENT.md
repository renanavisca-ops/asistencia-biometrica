# Despliegue

## Supabase (proyecto `grsezvfrkxzurgelyujv`, us-east-2)
- Migraciones: `supabase/migrations/*.sql` en orden. Aplicadas: 0100, 0200, 0300, 0310 y 0400 (MD5 verificados).
- Vault: secreto `template_enc_key`, generado en el servidor (no figura en el repositorio).
- Edge Function `device-api` (verify_jwt = **false**; autenticación propia por firma). Antes de desplegar: `pnpm sync:shared`.
- Recomendado en Auth: desactivar el registro público tras crear el primer superadministrador; activar la confirmación de correo; Site URL = la URL del panel.

## Panel en Vercel — **acción del propietario** (el conector no tiene permiso para crear proyectos)
1. Vercel → *Add New → Project* → importar `renanavisca-ops/asistencia-biometrica` (si no aparece, conceder acceso al repo a la app de Vercel en GitHub).
2. **Root Directory:** `apps/admin` · Framework: Next.js · activar «Include files outside the root directory» (monorepo pnpm).
3. Variables de entorno:
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://grsezvfrkxzurgelyujv.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = la clave *publishable* (Supabase → Settings → API Keys; es pública)
   - `NEXT_PUBLIC_ALLOW_SIGNUP` = `true` **solo** para crear la primera cuenta; después, `false` y redeploy.
   - **Nunca** añadir `service_role`.
4. Deploy. Abrir `/login` → «Crear cuenta (arranque inicial)» → confirmar el correo.

## Arranque del primer superadministrador
Tras registrarse, ejecutar en el SQL Editor de Supabase (sustituyendo el correo):
```sql
insert into public.admins (user_id, display_name, email)
select id, 'Nombre Apellido', email from auth.users where email = 'tu-correo@ejemplo.com';
insert into public.admin_role_grants (user_id, role) select user_id, 'superadmin' from public.admins where email = 'tu-correo@ejemplo.com';
```
Luego, iniciar sesión → configurar MFA → crear la organización, las regiones y las sedes.

## Móvil (Fase 3/6)
Android: Gradle en CI y APK firmado de pruebas (keystore como secreto de GitHub). iOS: requiere macOS (runner de GitHub o Mac propio) y una cuenta Apple Developer; distribución por TestFlight. **No se publica en tiendas sin autorización.**

## Rollback
- Panel: *Instant Rollback* en Vercel al despliegue anterior.
- Edge Function: redesplegar la versión anterior desde el repositorio (`git checkout <sha> -- supabase/functions`).
- BD: las migraciones son incrementales; un rollback es una **nueva** migración correctiva (como la 0310). Copias de seguridad diarias del plan Pro; valorar PITR antes de producción.
