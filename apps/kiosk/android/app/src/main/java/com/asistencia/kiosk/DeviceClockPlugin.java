package com.asistencia.kiosk;

import android.os.SystemClock;
import android.provider.Settings;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Reloj monotónico y contador de arranques para la lógica offline (ver packages/core/src/clock.ts),
 * y banderas de ventana para el modo quiosco.
 */
@CapacitorPlugin(name = "DeviceClock")
public class DeviceClockPlugin extends Plugin {

    @PluginMethod
    public void now(PluginCall call) {
        JSObject ret = new JSObject();
        // elapsedRealtime: milisegundos desde el arranque, incluido el tiempo en suspensión; no cambia si el usuario ajusta la hora.
        ret.put("elapsedRealtimeMs", SystemClock.elapsedRealtime());
        ret.put("wallMs", System.currentTimeMillis());
        try {
            ret.put("bootCount", Settings.Global.getInt(getContext().getContentResolver(), Settings.Global.BOOT_COUNT));
        } catch (Settings.SettingNotFoundException e) {
            ret.put("bootCount", JSObject.NULL);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void setKioskFlags(PluginCall call) {
        final boolean keepOn = Boolean.TRUE.equals(call.getBoolean("keepScreenOn", true));
        final boolean secure = Boolean.TRUE.equals(call.getBoolean("secure", true));
        getActivity().runOnUiThread(() -> {
            if (keepOn) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            // FLAG_SECURE impide capturas de pantalla y grabación de la vista de cámara/confirmaciones.
            if (secure) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            call.resolve();
        });
    }
}
