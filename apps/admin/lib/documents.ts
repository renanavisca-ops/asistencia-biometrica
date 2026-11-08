/** Documentos de identidad por país (Centroamérica + genéricos). */
export const COUNTRIES: [string, string][] = [
  ['GT', 'Guatemala'], ['SV', 'El Salvador'], ['HN', 'Honduras'], ['NI', 'Nicaragua'], ['CR', 'Costa Rica'], ['PA', 'Panamá'], ['BZ', 'Belice'],
];
export const DOC_TYPES: [string, string][] = [
  ['DPI', 'DPI (Guatemala)'], ['DUI', 'DUI (El Salvador)'], ['DNI', 'DNI / Identidad (Honduras)'], ['CEDULA', 'Cédula (CR, NI, PA)'],
  ['DIMEX', 'DIMEX (residentes en CR)'], ['PASAPORTE', 'Pasaporte'], ['OTRO', 'Otro'],
];
export const docLabel = (t: string | null) => DOC_TYPES.find(([k]) => k === t)?.[0] ?? t ?? '';
