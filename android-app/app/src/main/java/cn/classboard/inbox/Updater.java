package cn.classboard.inbox;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.atomic.AtomicBoolean;

/** App 自更新：检查版本 → 后台下载 → 校验签名 → 交给系统安装器，全程不用浏览器。 */
final class Updater {
    /** versionName 为 null 表示没有新版本（或检查失败）。 */
    interface Listener { void onReady(String versionName); }

    static final String APK_NAME = "classboard-update.apk";
    private static final String TAG = "classboard";
    private static final int MAX_APK_BYTES = 20 * 1024 * 1024;
    private static final AtomicBoolean BUSY = new AtomicBoolean(false);

    private Updater() {}

    /** 前台使用：检查并下载，完成后在主线程回调。 */
    static void checkAsync(final Context context, final Listener listener) {
        new Thread(() -> {
            final String version = check(context, false);
            if (listener != null) new Handler(Looper.getMainLooper()).post(() -> listener.onReady(version));
        }).start();
    }

    /** 后台轮询（JobScheduler）使用：下载完发一条通知，点通知即安装。 */
    static void checkInBackground(final Context context) {
        new Thread(() -> check(context, true)).start();
    }

    /** 返回已下载就绪的新版本号；没有新版本、检查失败或已有任务在跑时返回 null。 */
    static String check(Context context, boolean notify) {
        if (!BUSY.compareAndSet(false, true)) return null;
        try {
            SharedPreferences prefs = prefs(context);
            String text = Notifier.httpGet(Notifier.API_VERSION, null);
            if (text == null) return null;
            JSONObject info = new JSONObject(text);
            int code = info.optInt("versionCode", 0);
            if (code <= BuildConfig.VERSION_CODE) {
                clearStale(context, prefs);
                return null;
            }
            String name = info.optString("versionName", String.valueOf(code));
            if (prefs.getInt("update_code", 0) != code || !apkFile(context).exists()) {
                String url = info.optString("url", Notifier.SITE + "classboard.apk");
                if (!download(url, apkFile(context))) return null;
                if (!isOurApk(context, apkFile(context), code)) {
                    Log.w(TAG, "update apk rejected: " + url);
                    try { apkFile(context).delete(); } catch (Throwable ignored) {}
                    return null;
                }
                prefs.edit().putInt("update_code", code).apply();
            }
            if (notify && prefs.getInt("update_notified", 0) < code) {
                prefs.edit().putInt("update_notified", code).apply();
                postReadyNotification(context, name);
            }
            return name;
        } catch (Throwable t) {
            Log.w(TAG, "update check failed", t);
            return null;
        } finally {
            BUSY.set(false);
        }
    }

    /** 已有下载好的安装包待安装。 */
    static boolean ready(Context context) {
        return apkFile(context).exists() && prefs(context).getInt("update_code", 0) > BuildConfig.VERSION_CODE;
    }

    /** 用户选了「稍后」：本次版本不再自动弹窗（后台仍会提醒一次）。 */
    static void skip(Context context) {
        SharedPreferences prefs = prefs(context);
        prefs.edit().putInt("update_skipped", prefs.getInt("update_code", 0)).apply();
    }

    static boolean isSkipped(Context context) {
        SharedPreferences prefs = prefs(context);
        int code = prefs.getInt("update_code", 0);
        return code != 0 && prefs.getInt("update_skipped", 0) == code;
    }

    static boolean canInstall(Context context) {
        if (Build.VERSION.SDK_INT < 26) return true;
        try { return context.getPackageManager().canRequestPackageInstalls(); } catch (Throwable t) { return true; }
    }

    /** 跳系统「安装未知应用」授权页，用户返回后由 MainActivity 继续安装。 */
    static void requestInstallPermission(Context context) {
        try {
            context.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + context.getPackageName()))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (Throwable t) {
            try {
                context.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.parse("package:" + context.getPackageName()))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } catch (Throwable ignored) {}
        }
    }

    /** 拉起系统安装器；失败时回退到浏览器下载页。 */
    static boolean install(Context context) {
        if (!ready(context) || !canInstall(context)) return false;
        try {
            context.startActivity(new Intent(Intent.ACTION_VIEW)
                    .setDataAndType(ApkProvider.uri(), "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION));
            return true;
        } catch (Throwable t) {
            Log.w(TAG, "install failed", t);
            try {
                context.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(Notifier.SITE + "classboard.apk"))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } catch (Throwable ignored) {}
            return false;
        }
    }

    /** 装完新版本后清理下载缓存。 */
    private static void clearStale(Context context, SharedPreferences prefs) {
        if (prefs.getInt("update_code", 0) == 0) return;
        try { apkFile(context).delete(); } catch (Throwable ignored) {}
        prefs.edit().remove("update_code").remove("update_notified").remove("update_skipped").apply();
    }

    private static boolean download(String url, File target) {
        HttpURLConnection connection = null;
        File temp = new File(target.getParentFile(), target.getName() + ".tmp");
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(60000);
            connection.setRequestProperty("User-Agent", Notifier.UA);
            if (connection.getResponseCode() != 200) return false;
            try (InputStream in = connection.getInputStream(); FileOutputStream out = new FileOutputStream(temp)) {
                byte[] buffer = new byte[16384];
                int read, total = 0;
                while ((read = in.read(buffer)) != -1) {
                    total += read;
                    if (total > MAX_APK_BYTES) return false;
                    out.write(buffer, 0, read);
                }
                out.flush();
            }
            if (temp.length() < 10000) return false;
            if (target.exists() && !target.delete()) return false;
            return temp.renameTo(target);
        } catch (Throwable t) {
            Log.w(TAG, "download failed", t);
            return false;
        } finally {
            if (connection != null) connection.disconnect();
            if (temp.exists()) temp.delete();
        }
    }

    /** 只接受包名、版本号、签名都和当前 App 一致的安装包。 */
    private static boolean isOurApk(Context context, File apk, int code) {
        try {
            PackageManager manager = context.getPackageManager();
            PackageInfo archive = manager.getPackageArchiveInfo(apk.getAbsolutePath(), PackageManager.GET_SIGNATURES);
            if (archive == null || !context.getPackageName().equals(archive.packageName) || archive.versionCode != code) return false;
            if (archive.signatures == null || archive.signatures.length == 0) return false;
            PackageInfo self = manager.getPackageInfo(context.getPackageName(), PackageManager.GET_SIGNATURES);
            if (self.signatures == null || self.signatures.length == 0) return false;
            String remote = digest(archive.signatures[0]), local = digest(self.signatures[0]);
            return remote != null && remote.equals(local);
        } catch (Throwable t) {
            Log.w(TAG, "update verify failed", t);
            return false;
        }
    }

    private static String digest(Signature signature) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(signature.toByteArray());
            StringBuilder text = new StringBuilder();
            for (byte b : hash) text.append(String.format("%02x", b));
            return text.toString();
        } catch (Throwable t) {
            return null;
        }
    }

    private static void postReadyNotification(Context context, String versionName) {
        try {
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager == null) return;
            if (Build.VERSION.SDK_INT >= 33
                    && context.checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) return;
            if (Build.VERSION.SDK_INT >= 24 && !manager.areNotificationsEnabled()) return;
            if (Build.VERSION.SDK_INT >= 26) {
                NotificationChannel channel = new NotificationChannel(Notifier.CHANNEL, context.getString(R.string.channel_name), NotificationManager.IMPORTANCE_HIGH);
                channel.setDescription(context.getString(R.string.channel_desc));
                manager.createNotificationChannel(channel);
            }
            Intent intent = new Intent(context, MainActivity.class)
                    .putExtra(MainActivity.EXTRA_INSTALL, true)
                    .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent pending = PendingIntent.getActivity(context, 7102, intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                    ? new Notification.Builder(context, Notifier.CHANNEL)
                    : new Notification.Builder(context);
            builder.setSmallIcon(R.drawable.ic_stat_bell)
                    .setContentTitle("知可而办 " + versionName + " 已下载")
                    .setContentText("点按完成安装，登录状态会保留。")
                    .setStyle(new Notification.BigTextStyle().bigText("新版本已自动下载完成，点按这条通知即可安装，安装后登录状态自动保留。"))
                    .setColor(0xFF285BE8)
                    .setAutoCancel(true)
                    .setContentIntent(pending);
            manager.notify("classboard-update", 7102, builder.build());
        } catch (Throwable ignored) {}
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences("classboard", Context.MODE_PRIVATE);
    }

    private static File apkFile(Context context) {
        return new File(context.getFilesDir(), APK_NAME);
    }
}
