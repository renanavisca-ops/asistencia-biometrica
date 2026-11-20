# Pendientes antes de producción (actualizado 2026-11-20)

## Bloqueantes de la biometría (no usar para control laboral real hasta resolverlos)
1. **Validación con personas reales** en el teléfono de la tienda con el «modo validación» (protocolo en
   docs/RESULTADOS_PRUEBAS_BIOMETRICAS.md): FRR, FAR, identificación errónea, APCER por tipo de ataque y BPCER, con su
   tamaño de muestra. Hoy solo hay 1 marcación real registrada (n insuficiente).
2. **Calibrar y publicar umbrales** con esos datos (hoy 0,40 / 0,08 / 0,80 son provisionales).
3. **Decidir el modo de prueba de vida**: parpadeo (vigente, decisión del propietario) o aleatorio (más robusto contra
   vídeo), según el APCER medido con vídeos.
4. **Licencia comercial del motor** (docs/LICENCIAS_BIOMETRICAS.md): SFace y MiniFASNet son solo para validación. Requiere
   decisión y presupuesto del propietario (SDK comercial, modelo licenciado o entrenamiento propio).
5. Revisión legal por país (Centroamérica): base legal, aviso a empleados, retención, alternativa no biométrica.
6. Marcación supervisada (alternativa para quien no puede ser reconocido) — pendiente de definir el procedimiento.

## Infraestructura y operación
- **Correo de alertas**: cargar los secretos `RESEND_API_KEY` y `ALERTS_FROM_EMAIL` en Supabase (ver
  docs/PERSONAL_Y_REPORTES.md). Sin ellos los avisos quedan pendientes y las alertas siguen en el panel.
- Borrado real de archivos en Storage: implementado; aún sin archivos en producción con que comprobarlo.
- Mediciones prolongadas en el teléfono (varias horas, consumo de batería) con el modo validación.
- iOS: compilar y probar en un iPhone (requiere Mac con Xcode).
- Importantes: rotación de claves; limitación de frecuencia por IP en `device-api`; plan Vercel comercial; respaldos/PITR;
  borrado verificable de los datos de prueba antes de operar.
