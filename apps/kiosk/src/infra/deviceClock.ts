import { registerPlugin } from '@capacitor/core';

/** Plugin nativo propio (android/app/src/main/java/.../DeviceClockPlugin.java). */
export interface DeviceClockPlugin {
  now(): Promise<{ elapsedRealtimeMs: number; bootCount: number | null; wallMs: number }>;
  setKioskFlags(opts: { keepScreenOn: boolean; secure: boolean }): Promise<void>;
}
export const DeviceClock = registerPlugin<DeviceClockPlugin>('DeviceClock');
