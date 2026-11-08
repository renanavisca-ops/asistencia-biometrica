import type { Platform } from '../src/domain/platform.ts';

export class FakePlatform implements Platform {
  wall = Date.UTC(2026, 10, 9, 14, 0, 0);
  mono: number | null = 1_000_000;
  boot: string | null = 'boot-1';
  tz = -360;
  appVersion = '0.1.0-test';
  nowMs() { return this.wall; }
  async monotonicMs() { return this.mono; }
  async bootId() { return this.boot; }
  tzOffsetMin() { return this.tz; }
  uuid() { return crypto.randomUUID(); }
  async deviceInfo() { return { platform: 'android' as const, osVersion: '14', model: 'Test', batteryPct: 80 }; }
  /** Avanza el tiempo real (pared y monotónico juntos). */
  advance(ms: number) { this.wall += ms; if (this.mono != null) this.mono += ms; }
  reboot() { this.mono = 5_000; this.boot = 'boot-' + Math.random().toString(36).slice(2); }
}
