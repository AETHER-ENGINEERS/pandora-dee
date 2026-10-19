package app.netrunner.jade;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Keeps the app process (and the WebView running Jade's agent loop) alive while the app is in the
 * background: a foreground service with a quiet ongoing notification, plus a partial wake lock so the
 * CPU keeps running with the screen off. Started/stopped from JS via NetrunnerAndroid.keepAlive().
 */
public class KeepAliveService extends Service {
    static final String CHANNEL = "jade-background";
    static final int ID = 4242;
    PowerManager.WakeLock wake;

    @Override
    public IBinder onBind(Intent i) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String text = intent != null ? intent.getStringExtra("text") : null;
        if (text == null || text.length() == 0) text = "Jade is working";
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            Notification.Builder b;
            if (Build.VERSION.SDK_INT >= 26) {
                if (nm != null) nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Background work", NotificationManager.IMPORTANCE_LOW));
                b = new Notification.Builder(this, CHANNEL);
            } else {
                b = new Notification.Builder(this);
            }
            Intent open = new Intent(this, MainActivity.class);
            open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pi = PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            b.setSmallIcon(getApplicationInfo().icon)
                    .setContentTitle("Jade Vault")
                    .setContentText(text)
                    .setOngoing(true)
                    .setOnlyAlertOnce(true)
                    .setShowWhen(false)
                    .setColor(0xff1fe5a5)
                    .setContentIntent(pi);
            Notification n = b.build();
            if (Build.VERSION.SDK_INT >= 29) startForeground(ID, n, 1 /* ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC */);
            else startForeground(ID, n);
        } catch (Exception e) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (wake == null) {
            try {
                PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "jadevault:agent");
                wake.setReferenceCounted(false);
                wake.acquire(6L * 60 * 60 * 1000);
            } catch (Exception ignored) { }
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        try { if (wake != null && wake.isHeld()) wake.release(); } catch (Exception ignored) { }
        wake = null;
        super.onDestroy();
    }
}
