/**
 * Términos y condiciones del servicio (BORRADOR v1). Deben revisarse con un abogado en cada país antes de vender.
 * Se muestran en la app (registro de la organización) y en el panel (/terminos). La aceptación queda registrada con su versión.
 */
export const TERMS_VERSION = 'v1-2026-11';
export const PANEL_URL = 'https://asistencia-biometrica.vercel.app';

export const TERMS: { title: string; body: string[] }[] = [
  { title: '1. Qué es el servicio', body: [
    'Plataforma de control de asistencia con reconocimiento facial para organizaciones (la «Organización»). Se ofrece «tal cual» y en versión de prueba: el reconocimiento facial y la prueba de vida son experimentales y pueden cometer errores.',
  ] },
  { title: '2. Los datos son de la Organización', body: [
    'Todos los datos registrados (sucursales, empleados, documentos, rostros, marcaciones y reportes) pertenecen a la Organización, que decide qué registra y para qué (responsable del tratamiento). El proveedor de la plataforma solo los procesa para prestar el servicio (encargado del tratamiento).',
    'La Organización debe contar con base legal y con el consentimiento expreso de cada empleado para el uso de su rostro, informarle sus derechos y atender sus solicitudes de acceso, corrección y supresión.',
  ] },
  { title: '3. No somos un servicio de conservación de registros', body: [
    'La plataforma NO es un archivo ni un sistema de conservación de registros laborales. No se garantiza conservar los datos durante los plazos que exige la legislación laboral, tributaria o de otro tipo de cada país.',
    'Es responsabilidad exclusiva de la Organización descargar periódicamente sus datos (el panel permite exportarlos) y conservarlos por su cuenta durante los plazos legales que le apliquen.',
  ] },
  { title: '4. Limitación de responsabilidad', body: [
    'En la medida máxima permitida por la ley aplicable, el proveedor no es responsable por la pérdida, alteración o indisponibilidad de los datos, ni por decisiones laborales, pagos o sanciones basados en los registros de la plataforma, ni por daños indirectos o lucro cesante. La Organización debe revisar y validar los reportes antes de usarlos.',
  ] },
  { title: '5. Planes y pagos', body: [
    'Plan gratuito: hasta 5 empleados con rostro registrado. Planes de pago por cantidad de empleados con rostro registrado: 6–10, 11–20, 21–30, 31–50 y luego tramos de 50 (51–100, 101–150…). Al alcanzar el límite del plan no se pueden registrar más rostros hasta contratar el plan siguiente; el resto del servicio sigue funcionando.',
    'Si la membresía de pago vence o la organización es suspendida (por ejemplo, por falta de pago o uso indebido), el panel queda en solo lectura (descargar datos o eliminar la cuenta) y los teléfonos dejan de registrar asistencia hasta que se regularice.',
  ] },
  { title: '6. Cancelación y eliminación de datos', body: [
    'La Organización puede eliminar su cuenta desde el panel. Sus datos se conservan 90 días por si desea volver a suscribirse; pasado ese plazo se borran de forma definitiva y no se pueden recuperar. Las cuentas suspendidas siguen el mismo plazo si se solicita su eliminación.',
  ] },
  { title: '7. Acceso del proveedor', body: [
    'El proveedor ve solo cifras de uso (cantidad de empleados, sucursales, teléfonos y marcaciones) para administrar planes. Solo puede ver datos de la Organización si esta le concede acceso de soporte temporal y de solo lectura desde el panel; ese acceso queda registrado en su auditoría.',
  ] },
  { title: '8. Seguridad', body: [
    'Los rostros se guardan como plantillas cifradas (no como fotografías) y los documentos de identidad cifrados. La Organización es responsable de proteger las contraseñas y el autenticador de sus administradores y de los teléfonos autorizados.',
  ] },
  { title: '9. Cambios', body: [
    'Estos términos pueden actualizarse; los cambios relevantes se avisarán en el panel. Seguir usando el servicio implica aceptar la versión vigente.',
  ] },
];
