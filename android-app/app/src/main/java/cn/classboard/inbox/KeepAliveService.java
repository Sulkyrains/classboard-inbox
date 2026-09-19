package cn.classboard.inbox;

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

/**
 * 后台常驻：国内定制系统会冻结甚至清掉后台进程，前台服务能让进程活着，
 * 轮询由 JobScheduler / 闹钟负责找人，这里只负责「人还在」。
 */
public class KeepAliveService extends Service {
    private static final int ID = 4201;
    private static final String CHANNEL = "classboard-keepalive";

    static void start(Context context) {
        try {
            Intent intent = new Intent(context, KeepAliveService.class);
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
            else context.startService(intent);
        } catch (Throwable ignored) {
            // Android 12+ 后台启动前台服务会抛异常：下次打开 App 时会再试
        }
    }

    static void stop(Context context) {
        try { context.stopService(new Intent(context, KeepAliveService.class)); } catch (Throwable ignored) {}
    }

    @Override
    public void onCreate() {
        super.onCreate();
        try { foreground(); } catch (Throwable ignored) {}
    }

    private void foreground() {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null && Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, getString(R.string.keepalive_channel), NotificationManager.IMPORTANCE_LOW);
            channel.setDescription(getString(R.string.keepalive_desc));
            channel.setShowBadge(false);
            manager.createNotificationChannel(channel);
        }
        PendingIntent pending = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL)
                : new Notification.Builder(this);
        builder.setSmallIcon(R.drawable.ic_stat_bell)
                .setContentTitle(getString(R.string.keepalive_title))
                .setContentText(getString(R.string.keepalive_text))
                .setOngoing(true)
                .setShowWhen(false)
                .setContentIntent(pending);
        if (Build.VERSION.SDK_INT >= 34) startForeground(ID, builder.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(ID, builder.build());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try { if (!Notifier.keepAlive(this)) { stopSelf(); return START_NOT_STICKY; } } catch (Throwable ignored) {}
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
