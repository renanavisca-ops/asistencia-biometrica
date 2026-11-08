import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.asistencia.kiosk',
  appName: 'Asistencia Tienda',
  webDir: 'dist',
  // captureInput desactivado: interfería con las sugerencias del teclado (espacios añadidos y borrado bloqueado en el campo de correo).
  android: { allowMixedContent: false, webContentsDebuggingEnabled: false },
  plugins: {
    CapacitorSQLite: {
      // Base local cifrada con SQLCipher; la frase secreta queda protegida por Android Keystore.
      androidIsEncryption: true,
      androidBiometric: { biometricAuth: false },
      iosIsEncryption: true,
      iosKeychainPrefix: 'asistencia-kiosk',
    },
  },
};
export default config;
