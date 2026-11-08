# Estado del proyecto (actualizado 2026-11-08)

| Área | Estado | Evidencia |
|---|---|---|
| Fase 0 — conectores, infraestructura, matriz biométrica | ✅ Completado | docs/CONNECTORS_AND_INFRASTRUCTURE.md, docs/BIOMETRICS.md |
| Supabase: esquema, RBAC/RLS, ingesta, correcciones, dispositivos, Vault | ✅ Completado | 5 migraciones aplicadas (MD5 = repositorio); 70 comprobaciones SQL |
| Edge Function `device-api` | ✅ Desplegada | 9 pasos de integración + prueba de humo en producción |
| Panel administrativo Next.js | 🟡 Código completo, **sin desplegar** | Compila; login probado contra Auth real. Bloqueado: crear el proyecto en Vercel (el conector no tiene permiso) |
| Invitación de administradores por correo | ⬜ No iniciado | Hoy el alta es por SQL o registro inicial (docs/DEPLOYMENT.md) |
| Procedimiento supervisado para no reconocidos / sin biometría | ⬜ No iniciado | El esquema lo admite (`supervised_exception`) |
| Fase 3 — app móvil Capacitor (offline, SQLite cifrado, Keystore/Keychain) | ⬜ No iniciado | — |
| Fase 4 — reconocimiento facial 1:N | ❌ **NO IMPLEMENTADO** | Solo comparador de vectores |
| Fase 4 — prueba de vida / PAD | ❌ **NO IMPLEMENTADO** | Sin modelo evaluado. **El sistema NO es apto para producción** |
| Revisión legal por país (Centroamérica) | ⬜ Pendiente del propietario | docs/SECURITY_PRIVACY.md |

## Decisiones del propietario
- Reutilizar el proyecto Supabase «Centro de Capacitacion», borrando su contenido (hecho).
- Repositorio creado por el propietario.
- Biometría por dos vías en paralelo: prototipo open-source y evaluación comercial.
- Operación en Centroamérica; los países concretos están por definir.
- Aprobado: proyecto Vercel (pendiente por permisos) y secreto de cifrado (hecho, en Vault).

## Siguientes pasos
1. El propietario crea el proyecto en Vercel (docs/DEPLOYMENT.md) → arranque del superadministrador → prueba manual del panel.
2. Fase 3: app de tienda (Capacitor + módulos nativos) con activación, SQLite cifrado, cola de sincronización y pantalla de marcación (biometría simulada **etiquetada como tal** solo para probar la infraestructura).
3. Fase 4 en paralelo: prototipo YuNet + SFace + Silent-Face; solicitud de cotizaciones a 2–3 proveedores con PAD certificado.
