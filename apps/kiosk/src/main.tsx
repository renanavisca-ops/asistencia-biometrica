import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { KioskService } from './domain/kiosk.ts';
import { DeviceApi } from './domain/http.ts';
import { MemoryStore, type LocalStore } from './domain/store.ts';
import { capacitorPlatform } from './infra/platform.capacitor.ts';
import { DeviceClock } from './infra/deviceClock.ts';
import { KioskApp } from './ui/App.tsx';
import './ui/styles.css';

const API = import.meta.env.VITE_DEVICE_API_URL ?? 'https://grsezvfrkxzurgelyujv.supabase.co/functions/v1/device-api';

async function boot() {
  let store: LocalStore;
  const native = Capacitor.isNativePlatform();
  if (native) {
    const { SqliteStore } = await import('./infra/sqliteStore.ts');
    store = await SqliteStore.open();
    DeviceClock.setKioskFlags({ keepScreenOn: true, secure: true }).catch(() => {});
  } else {
    store = new MemoryStore(); // navegador: solo para desarrollo de interfaz
  }
  const svc = new KioskService(store, new DeviceApi(API, (url, init) => fetch(url, init)), capacitorPlatform);
  createRoot(document.getElementById('root')!).render(<KioskApp svc={svc} persistent={native} />);
}
boot();
