package cn.classboard.inbox;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.PowerManager;

/**
 * 闹钟兜底：JobScheduler 在国内定制系统上会被冻结，这个广播由 AlarmManager 的
 * doze 例外闹钟拉起，能唤醒设备完成一次轮询。
 */
public class PollReceiver extends BroadcastReceiver {
    static final String ACTION_POLL = "cn.classboard.inbox.POLL";

    @Override
    public void onReceive(Context context, Intent intent) {
        final PendingResult pending = goAsync();
        final Context app = context.getApplicationContext();
        PowerManager.WakeLock lock = null;
        try {
            PowerManager power = (PowerManager) app.getSystemService(Context.POWER_SERVICE);
            if (power != null) {
                lock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "classboard:poll");
                lock.acquire(60_000L);
            }
        } catch (Throwable ignored) {}
        final PowerManager.WakeLock held = lock;
        new Thread(() -> {
            try { Notifier.refresh(app, "alarm"); } catch (Throwable ignored) {}
            try { if (held != null && held.isHeld()) held.release(); } catch (Throwable ignored) {}
            try { pending.finish(); } catch (Throwable ignored) {}
        }).start();
        // 每次触发都要续上下一次：setAndAllowWhileIdle 只响一次
        try { Notifier.schedule(app); } catch (Throwable ignored) {}
        // 系统清掉进程后，靠这一手在几分钟内自己站起来，不用等用户再点开 App
        try { Notifier.ensureService(app); } catch (Throwable ignored) {}
    }
}
