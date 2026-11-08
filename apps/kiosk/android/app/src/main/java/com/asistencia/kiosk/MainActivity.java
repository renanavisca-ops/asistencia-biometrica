package com.asistencia.kiosk;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DeviceClockPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
