import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';
import type { Platform } from '../domain/platform.ts';
import { DeviceClock } from './deviceClock.ts';

export const APP_VERSION = '0.4.4';

/** Plataforma real: reloj monotónico y contador de arranques nativos (Android). En navegador, valores nulos. */
export const capacitorPlatform: Platform = {
  appVersion: APP_VERSION,
  nowMs: () => Date.now(),
  async monotonicMs() {
    if (!Capacitor.isNativePlatform()) return null;
    try { return (await DeviceClock.now()).elapsedRealtimeMs; } catch { return null; }
  },
  async bootId() {
    if (!Capacitor.isNativePlatform()) return null;
    try { const b = (await DeviceClock.now()).bootCount; return b == null ? null : `boot-${b}`; } catch { return null; }
  },
  tzOffsetMin: () => -new Date().getTimezoneOffset(),
  uuid: () => crypto.randomUUID(),
  async deviceInfo() {
    const [info, battery] = await Promise.all([Device.getInfo(), Device.getBatteryInfo().catch(() => ({ batteryLevel: undefined }))]);
    return {
      platform: info.platform === 'ios' ? 'ios' : 'android',
      osVersion: info.osVersion, model: `${info.manufacturer} ${info.model}`,
      batteryPct: battery.batteryLevel == null ? null : Math.round(battery.batteryLevel * 100),
    };
  },
};
