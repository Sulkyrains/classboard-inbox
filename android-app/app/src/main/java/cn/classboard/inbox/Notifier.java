package cn.classboard.inbox;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.PowerManager;
import android.util.Log;
import android.webkit.CookieManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;

/**
 * 通知与后台轮询：不依赖 GMS，用系统 JobScheduler + AlarmManager 直连班级 API。
 * 国内定制系统（ColorOS/OriginOS 等）会冻结后台进程，所以这里做了双通道唤醒：
 * JobScheduler 负责常规调度，AlarmManager 的 doze 例外闹钟做兜底，两者都失败就只能靠打开 App。
 */
public final class Notifier {
    static final String SITE = "https://classboard-upc.pages.dev/";
    static final String API_NOTICES = "https://classboard-upc.pages.dev/api/notices";
    static final String API_VERSION = "https://classboard-upc.pages.dev/app-version.json";
    static final String CHANNEL = "classboard-notices";
    static final String UA = "Mozilla/5.0 (Linux; Android " + Build.VERSION.RELEASE + ") AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 ClassboardApp/" + BuildConfig.VERSION_NAME;
    private static final String PREFS = "classboard";
    private static final int JOB_ID = 4101;
    private static final int ALARM_REQUEST = 4102;
    /** JobScheduler 的周期下限就是 15 分钟，想更快只能靠闹钟和常驻服务。 */
    static final long JOB_INTERVAL_MS = 15 * 60 * 1000L;
    static final long ALARM_INTERVAL_MS = 5 * 60 * 1000L;
    static final long SERVICE_INTERVAL_MS = 60 * 1000L;
    private static final long POLL_THROTTLE_MS = 20_000L;
    /** 版本检查跟轮询解耦：一小时最多一次，别把请求量翻倍。 */
    private static final long UPDATE_CHECK_MS = 60 * 60 * 1000L;
    private static final int MAX_SEEN = 800;
    /** 由 KeepAliveService 维护，自检面板据此判断常驻是否真的在跑。 */
    static volatile boolean serviceRunning = false;

    private Notifier() {}

    /** 两套后台唤醒都注册上：JobScheduler 省电、闹钟扛得住系统冻结。 */
    static void schedule(Context context) {
        scheduleJob(context);
        scheduleAlarm(context);
    }

    static void cancelBackground(Context context) {
        try {
            JobScheduler scheduler = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (scheduler != null) scheduler.cancel(JOB_ID);
        } catch (Throwable ignored) {}
        try {
            AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (manager != null) manager.cancel(alarmIntent(context));
        } catch (Throwable ignored) {}
    }

    private static void scheduleJob(Context context) {
        // 部分定制系统上 JobScheduler 会抛异常，轮询失败也不能影响界面
        try {
            JobScheduler scheduler = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (scheduler == null) return;
            try {
                for (JobInfo job : scheduler.getAllPendingJobs()) if (job.getId() == JOB_ID) return;
            } catch (Throwable ignored) {
            }
            JobInfo info = new JobInfo.Builder(JOB_ID, new ComponentName(context, PollJobService.class))
                    .setPersisted(true)
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .setPeriodic(JOB_INTERVAL_MS)
                    .build();
            scheduler.schedule(info);
        } catch (Throwable t) {
            Log.w("classboard", "JobScheduler unavailable", t);
        }
    }

    /** setAndAllowWhileIdle 不需要「精确闹钟」权限，且在 doze 里也能唤醒。 */
    private static void scheduleAlarm(Context context) {
        try {
            AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (manager == null) return;
            manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + ALARM_INTERVAL_MS, alarmIntent(context));
        } catch (Throwable t) {
            Log.w("classboard", "alarm unavailable", t);
        }
    }

    private static PendingIntent alarmIntent(Context context) {
        Intent intent = new Intent(context, PollReceiver.class).setAction(PollReceiver.ACTION_POLL);
        return PendingIntent.getBroadcast(context, ALARM_REQUEST, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** 后台常驻（前台服务）：国产系统上保持进程存活，默认开启，可在「个人账号」里关掉。 */
    static boolean keepAlive(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("keep_alive", true);
    }

    static void setKeepAlive(Context context, boolean on) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("keep_alive", on).apply();
        if (on) KeepAliveService.start(context); else KeepAliveService.stop(context);
    }

    static void refreshAsync(final Context context, final String source) {
        new Thread(() -> {
            try { refresh(context, source); } catch (Throwable ignored) {}
        }).start();
    }

    /** 拉取一次通知列表，把新通知发成本地系统通知。 */
    static void refresh(Context context, String source) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        long now = System.currentTimeMillis();
        if (now - prefs.getLong("last_poll_ms", 0L) < POLL_THROTTLE_MS) return;
        prefs.edit().putLong("last_poll_ms", now).putString("last_source", source).apply();
        if (now - prefs.getLong("last_update_check", 0L) > UPDATE_CHECK_MS) {
            prefs.edit().putLong("last_update_check", now).apply();
            Updater.checkInBackground(context);
        }
        String cookie = cookie(context);
        if (cookie == null || !cookie.contains("cb_session=")) { record(prefs, source, "nologin", 0); return; }
        boolean[] notModified = new boolean[1];
        String[] freshTag = new String[1];
        int[] code = new int[1];
        JSONArray notices = fetchNotices(cookie, prefs.getString("feed_etag", null), notModified, freshTag, code);
        // 列表没变时服务端只读一行版本号就回 304：一分钟一轮也不会把数据库额度烧穿。
        if (notModified[0]) { record(prefs, source, "ok", 0); return; }
        // 会话过期和网络不通要分开报：否则自检面板会把「该重新登录」说成「网络有问题」。
        if (code[0] == 401) { prefs.edit().remove("feed_etag").apply(); record(prefs, source, "nologin", 0); return; }
        if (notices == null) { record(prefs, source, "network", 0); return; }
        if (freshTag[0] != null) prefs.edit().putString("feed_etag", freshTag[0]).apply();

        LinkedHashSet<String> seen = readSeen(prefs);
        boolean seeded = prefs.getBoolean("seeded", false);
        List<String[]> fresh = new ArrayList<>();
        List<String> ids = new ArrayList<>();
        for (int i = 0; i < notices.length(); i++) {
            JSONObject n = notices.optJSONObject(i);
            if (n == null) continue;
            String id = n.optString("id", "");
            if (id.isEmpty()) continue;
            ids.add(id);
            if (seen.contains(id)) continue;
            if (seeded) {
                String title = "【" + n.optString("category", "通知") + "】" + n.optString("title", "");
                String body = n.optString("body", "");
                fresh.add(new String[]{id, title, body.length() > 90 ? body.substring(0, 90) + "…" : body});
            }
        }
        // 新通知在前，保留最近的记录，避免清单无限增长
        for (String[] item : fresh) notify(context, item[0], item[1], item[2], null);
        LinkedHashSet<String> seenAfter = readSeen(prefs);
        LinkedHashSet<String> next = new LinkedHashSet<>(ids);
        for (String id : seenAfter) {
            if (next.size() >= MAX_SEEN) break;
            next.add(id);
        }
        saveSeen(prefs, next);
        prefs.edit().putBoolean("seeded", true).apply();
        record(prefs, source, "ok", fresh.size());
    }

    /** 顺带记一笔「后台检查」的次数与时间：自检面板靠它证明后台到底有没有在跑。 */
    private static void record(SharedPreferences prefs, String source, String result, int fresh) {
        SharedPreferences.Editor editor = prefs.edit()
                .putLong("last_at", System.currentTimeMillis())
                .putString("last_result", result)
                .putInt("last_new", fresh);
        if (!"app".equals(source) && !"manual".equals(source)) {
            editor.putLong("bg_at", System.currentTimeMillis()).putInt("bg_count", prefs.getInt("bg_count", 0) + 1);
        }
        editor.apply();
    }

    /** 「通知自检」面板用的状态快照，字段越少越好改。 */
    static String status(Context context) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            JSONObject json = new JSONObject();
            json.put("version", BuildConfig.VERSION_NAME);
            // 上次检查被服务端判了未登录时，别再看 cookie 装已登录：面板要说得准。
            json.put("login", cookie(context) != null && !"nologin".equals(prefs.getString("last_result", "")));
            json.put("permission", Build.VERSION.SDK_INT < 33
                    || context.checkSelfPermission("android.permission.POST_NOTIFICATIONS") == PackageManager.PERMISSION_GRANTED);
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            json.put("enabled", manager == null || manager.areNotificationsEnabled());
            PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            json.put("ignoring", power != null && power.isIgnoringBatteryOptimizations(context.getPackageName()));
            json.put("keepAlive", keepAlive(context));
            json.put("lastAt", prefs.getLong("last_at", 0L));
            json.put("lastResult", prefs.getString("last_result", "none"));
            json.put("lastNew", prefs.getInt("last_new", 0));
            json.put("lastSource", prefs.getString("last_source", ""));
            json.put("bgAt", prefs.getLong("bg_at", 0L));
            json.put("bgCount", prefs.getInt("bg_count", 0));
            json.put("service", serviceRunning);
            json.put("job", hasJob(context));
            json.put("alarm", alarmPending(context));
            return json.toString();
        } catch (Throwable t) {
            return "{}";
        }
    }

    private static boolean hasJob(Context context) {
        try {
            JobScheduler scheduler = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (scheduler == null) return false;
            for (JobInfo job : scheduler.getAllPendingJobs()) if (job.getId() == JOB_ID) return true;
        } catch (Throwable ignored) {}
        return false;
    }

    private static boolean alarmPending(Context context) {
        try {
            Intent intent = new Intent(context, PollReceiver.class).setAction(PollReceiver.ACTION_POLL);
            return PendingIntent.getBroadcast(context, ALARM_REQUEST, intent, PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE) != null;
        } catch (Throwable ignored) {
            return false;
        }
    }

    /** 自检面板里的「发送测试通知」：只发本地通知，不经过服务器。 */
    static void testNotify(Context context) {
        notify(context, "selftest-" + System.currentTimeMillis(), "知可而办 · 测试通知",
                "能看到这条通知，说明这台手机的通知权限正常。", null);
    }

    /** 带 ETag 校验拉取列表：notModified[0] 为真表示服务端回了 304，沿用上次结果。 */
    private static JSONArray fetchNotices(String cookie, String etag, boolean[] notModified, String[] freshTag, int[] codeOut) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(API_NOTICES).openConnection();
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(15000);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", UA);
            if (cookie != null) connection.setRequestProperty("Cookie", cookie);
            if (etag != null && !etag.isEmpty()) connection.setRequestProperty("If-None-Match", etag);
            int code = connection.getResponseCode();
            codeOut[0] = code;
            if (code == 304) { notModified[0] = true; return null; }
            if (code != 200) return null;
            freshTag[0] = connection.getHeaderField("ETag");
            try (InputStream in = connection.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                int read;
                while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
                return new JSONObject(out.toString(StandardCharsets.UTF_8.name())).optJSONArray("notices");
            }
        } catch (Throwable e) {
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    /** 网页内新通知：走 JS 桥，id 用于去重，避免与后台轮询重复提醒。 */
    static void notifyFromWeb(Context context, String id, String title, String body) {
        notify(context, id, title, body, null);
    }

    private static void notify(Context context, String id, String title, String body, String openUrl) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        if (Build.VERSION.SDK_INT >= 33
                && context.checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) return;
        if (Build.VERSION.SDK_INT >= 24 && !manager.areNotificationsEnabled()) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (id != null && !id.isEmpty()) {
            LinkedHashSet<String> seen = readSeen(prefs);
            if (seen.contains(id)) return;
            LinkedHashSet<String> next = new LinkedHashSet<>();
            next.add(id);
            for (String old : seen) {
                if (next.size() >= MAX_SEEN) break;
                next.add(old);
            }
            saveSeen(prefs, next);
        }
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, context.getString(R.string.channel_name), NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription(context.getString(R.string.channel_desc));
            manager.createNotificationChannel(channel);
        }
        Intent intent;
        if (openUrl != null && !openUrl.isEmpty()) {
            intent = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(openUrl));
        } else {
            intent = new Intent(context, MainActivity.class)
                    .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        }
        PendingIntent pending = PendingIntent.getActivity(
                context,
                id == null ? 0 : id.hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(context, CHANNEL)
                : new Notification.Builder(context);
        builder.setSmallIcon(R.drawable.ic_stat_bell)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setColor(0xFF285BE8)
                .setAutoCancel(true)
                .setContentIntent(pending);
        manager.notify(id == null ? "classboard" : id, 1, builder.build());
    }

    static void syncCookie(Context context, String url) {
        try {
            String cookie = CookieManager.getInstance().getCookie(url);
            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            if (cookie == null || !cookie.contains("cb_session=")) prefs.edit().remove("cookie").apply();
            else prefs.edit().putString("cookie", cookie).apply();
        } catch (Throwable ignored) {}
    }

    private static String cookie(Context context) {
        try {
            String cookie = CookieManager.getInstance().getCookie(SITE);
            if (cookie != null && cookie.contains("cb_session=")) return cookie;
        } catch (Throwable ignored) {}
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("cookie", null);
    }

    private static LinkedHashSet<String> readSeen(SharedPreferences prefs) {
        LinkedHashSet<String> set = new LinkedHashSet<>();
        try {
            JSONArray array = new JSONArray(prefs.getString("seen_ids", "[]"));
            for (int i = 0; i < array.length(); i++) set.add(array.optString(i));
        } catch (Exception ignored) {}
        return set;
    }

    private static void saveSeen(SharedPreferences prefs, LinkedHashSet<String> set) {
        JSONArray array = new JSONArray();
        for (String id : set) array.put(id);
        prefs.edit().putString("seen_ids", array.toString()).apply();
    }

    static String httpGet(String url, String cookie) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(15000);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", UA);
            if (cookie != null) connection.setRequestProperty("Cookie", cookie);
            if (connection.getResponseCode() != 200) return null;
            try (InputStream in = connection.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                int read;
                while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
                return out.toString(StandardCharsets.UTF_8.name());
            }
        } catch (Throwable e) {
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
}
