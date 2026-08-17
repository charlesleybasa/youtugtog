package com.youtugtog.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;

/**
 * Foreground service held for the duration of playback.
 *
 * BackgroundAudioWebView keeps the WebView willing to play with the screen off,
 * but that alone is not enough: once the app is backgrounded Android is free to
 * freeze or kill the process, which stops the audio anyway. A running
 * foreground service is what buys the process the right to stay alive.
 *
 * The notification here is intentionally minimal and low-importance. The real
 * transport controls come from the web layer's navigator.mediaSession, which
 * publishes its own media notification with artwork and play/pause/skip; this
 * one exists because a foreground service is required to post something.
 */
public class PlaybackService extends Service {

    private static final String CHANNEL_ID = "playback";
    private static final int NOTIFICATION_ID = 1;

    public static void start(Context context) {
        Intent intent = new Intent(context, PlaybackService.class);
        // startForegroundService requires startForeground() within ~5s, which
        // onCreate does, so the "did not start in time" ANR does not apply.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    public static void stop(Context context) {
        context.stopService(new Intent(context, PlaybackService.class));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();

        Intent launch = new Intent(this, MainActivity.class);
        launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            0,
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Youtugtog")
            .setContentText("Playing in the background")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(contentIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .build();

        // Android 14+ rejects a mediaPlayback service that does not declare its
        // type at startForeground time as well as in the manifest.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Deliberately not START_STICKY: if the process is killed the WebView
        // and its player are gone, so a restarted service would only replace
        // the audio with a notification for playback that no longer exists.
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Playback",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Keeps music playing while the app is in the background");
        channel.setShowBadge(false);
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }
}
