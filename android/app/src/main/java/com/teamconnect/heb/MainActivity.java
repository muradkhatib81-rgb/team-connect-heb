package com.teamconnect.heb;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/**
 * Capacitor shell entry. Creates Android notification channels with dedicated
 * sounds so FCM can target them later (schedules, breaks, messages, etc.).
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ensureNotificationChannels();
    }

    private void ensureNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;

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
            attrs,
            NotificationManager.IMPORTANCE_HIGH
        );
        createChannel(
            manager,
            "break_start",
            "התחלת הפסקה",
            "התראה חזקה לתחילת הפסקה",
            R.raw.break_start,
            attrs,
            NotificationManager.IMPORTANCE_HIGH
        );
        createChannel(
            manager,
            "break_end",
            "סיום הפסקה",
            "התראה חזקה לסיום הפסקה",
            R.raw.break_end,
            attrs,
            NotificationManager.IMPORTANCE_HIGH
        );
        createChannel(
            manager,
            "break_late",
            "איחור בהפסקה",
            "התראה חזקה לאיחור בהפסקה",
            R.raw.break_late,
            attrs,
            NotificationManager.IMPORTANCE_HIGH
        );
    }

    private void createChannel(
        NotificationManager manager,
        String id,
        String name,
        String description,
        int soundRes,
        AudioAttributes attrs,
        int importance
    ) {
        NotificationChannel channel = new NotificationChannel(id, name, importance);
        channel.setDescription(description);
        channel.enableVibration(true);
        channel.setSound(
            Uri.parse("android.resource://" + getPackageName() + "/" + soundRes),
            attrs
        );
        manager.createNotificationChannel(channel);
    }
}
