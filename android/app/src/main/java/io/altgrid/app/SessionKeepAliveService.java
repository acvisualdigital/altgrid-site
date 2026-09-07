package io.altgrid.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

/** Keeps the Android process eligible to continue WebView game sessions. */
public final class SessionKeepAliveService extends Service {
    private static final String CHANNEL_ID = "altgrid_sessions";
    private static final int NOTIFICATION_ID = 1601;

    @Override
    public void onCreate() {
        super.onCreate();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Sessões AltGrid",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Mantém as contas do AltGrid conectadas em segundo plano.");
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
        startForeground(NOTIFICATION_ID, buildNotification());
    }

    private Notification buildNotification() {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_popup_sync)
            .setContentTitle("AltGrid ativo")
            .setContentText("Mantendo suas contas conectadas em segundo plano")
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
