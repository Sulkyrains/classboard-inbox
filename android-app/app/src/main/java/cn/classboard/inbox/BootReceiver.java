package cn.classboard.inbox;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** 开机 / 覆盖安装后重新挂上后台唤醒，否则闹钟和任务都会丢。 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        Context app = context.getApplicationContext();
        try { Notifier.schedule(app); } catch (Throwable ignored) {}
        try { if (Notifier.keepAlive(app)) KeepAliveService.start(app); } catch (Throwable ignored) {}
    }
}
