package com.youtugtog.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final int REQUEST_POST_NOTIFICATIONS = 1001;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must be registered before super.onCreate(), which is where the bridge
        // is built and the plugin set is frozen.
        registerPlugin(BackgroundAudioPlugin.class);
        super.onCreate(savedInstanceState);
        requestNotificationPermission();
    }

    /**
     * Android 13+ gates notifications behind a runtime permission. Denying it
     * does not stop the foreground service or the audio — it only hides the
     * playback notification and the media controls that go with it, so this is
     * requested but never enforced.
     */
    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;

        boolean granted =
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED;

        if (!granted) {
            ActivityCompat.requestPermissions(
                this,
                new String[] { Manifest.permission.POST_NOTIFICATIONS },
                REQUEST_POST_NOTIFICATIONS
            );
        }
    }
}
