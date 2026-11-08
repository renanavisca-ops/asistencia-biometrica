import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.asistencia.kiosk',
  appName: 'Asistencia Tienda',
  webDir: 'dist',
  android: { allowMixedContent: false, captureInput: true, webContentsDebuggingEnabled: false },
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
