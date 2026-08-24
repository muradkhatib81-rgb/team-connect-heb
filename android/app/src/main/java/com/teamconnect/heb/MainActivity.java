package com.teamconnect.heb;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/**
 * Capacitor shell entry. Recreates Android notification channels with high
 * importance + sound so FCM can alert when the app is backgrounded or killed.
 */
public class MainActivity extends BridgeActivity {
    private static final int CHANNEL_VERSION = 2;
    private static final String PREFS = "tc_push";
    private static final String PREFS_CHANNEL_VERSION = "channel_version";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ensureNotificationChannels();
    }

    private void ensureNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;

        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        int installed = prefs.getInt(PREFS_CHANNEL_VERSION, 0);
        if (installed < CHANNEL_VERSION) {
            manager.deleteNotificationChannel("general");
            manager.deleteNotificationChannel("break_start");
            manager.deleteNotificationChannel("break_end");
            manager.deleteNotificationChannel("break_late");
            prefs.edit().putInt(PREFS_CHANNEL_VERSION, CHANNEL_VERSION).apply();
        }

        AudioAttributes attrs = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();

        createChannel(
            manager,
            "general",
            "התראות כלליות",
            "סידורים, הודעות, משימות ועדכונים",
            R.raw.notify_default,
            attrs
        );
        createChannel(
            manager,
            "break_start",
            "התחלת הפסקה",
            "התראה חזקה לתחילת הפסקה",
            R.raw.break_start,
            attrs
        );
        createChannel(
            manager,
            "break_end",
            "סיום הפסקה",
            "התראה חזקה לסיום הפסקה",
            R.raw.break_end,
            attrs
        );
        createChannel(
            manager,
            "break_late",
            "איחור בהפסקה",
            "התראה חזקה לאיחור בהפסקה",
            R.raw.break_late,
            attrs
        );
    }

    private void createChannel(
        NotificationManager manager,
        String id,
        String name,
        String description,
        int soundRes,
        AudioAttributes attrs
    ) {
        NotificationChannel channel = new NotificationChannel(
            id,
            name,
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription(description);
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[] { 0, 400, 120, 400, 120, 600 });
        channel.enableLights(true);
        channel.setShowBadge(true);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        channel.setSound(
            Uri.parse("android.resource://" + getPackageName() + "/" + soundRes),
            attrs
        );
        manager.createNotificationChannel(channel);
    }
}
