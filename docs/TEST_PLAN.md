# Plan de pruebas y evidencias

| Área | Prueba | Cómo | Resultado (2026-11-08) |
|---|---|---|---|
| Motor IN/OUT, sesiones, firma, reloj, matching, protocolo | 31 pruebas unitarias | `pnpm test` | ✅ 31/31 |
| Aislamiento RLS (organizaciones, tiendas, roles, MFA, anon) | 15 comprobaciones | `pnpm test:db` (10_rls_and_ingest.sql) | ✅ |
| Ingesta: aceptación, revisión, rechazo, idempotencia, clones, conflictos offline, inmutabilidad | 14 comprobaciones | ídem | ✅ |
| Correcciones auditadas, traslados, bajas, roster | 16 comprobaciones | ídem | ✅ |
| Activación, desafíos, enrolamiento central cifrado, roster, bloqueo, derecho de supresión | 25 comprobaciones | `pnpm test:db` (20_devices_biometrics.sql) | ✅ |
| Edge Function extremo a extremo (firma real Ed25519 + Postgres real) | 9 pasos | `pnpm test:edge` | ✅ 9/9 |
| Edge Function desplegada | Prueba de humo: rutas, 401/403/404/405 | curl a producción | ✅ |
| Panel: compilación y tipos | `next build`, `tsc` | local | ✅ |
| Panel: redirección sin sesión, cabeceras, login contra Auth real | curl + Playwright | local contra Supabase | ✅ |
| Panel: flujo completo con MFA y datos reales | Manual tras el arranque del superadmin | Vercel | ⏳ pendiente |
| App móvil, offline real, cierre forzado, reinicio | Dispositivos Android/iPhone | Fase 3 | ⏳ |
| Exactitud biométrica (FPIR/FNIR con IC 95 %) y PAD (APCER/BPCER) | Ver docs/BIOMETRICS.md | Fase 4 | ⏳ **NO IMPLEMENTADO** |
| Rendimiento por modelo de teléfono | Latencia, batería, temperatura | Fase 4 | ⏳ |
| Exportaciones coinciden con eventos auditados | Comparar CSV con `attendance_events` | Fase 5 | ⏳ |
