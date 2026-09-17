package cn.classboard.inbox;

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

/** 通知与后台轮询：不依赖 GMS，用系统 JobScheduler + 直连班级 API。 */
public final class Notifier {
    static final String SITE = "https://classboard-inbox.pages.dev/";
    static final String API_NOTICES = "https://classboard-inbox.pages.dev/api/notices";
    static final String API_VERSION = "https://classboard-inbox.pages.dev/app-version.json";
    static final String CHANNEL = "classboard-notices";
    static final String UA = "Mozilla/5.0 (Linux; Android " + Build.VERSION.RELEASE + ") AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 ClassboardApp/" + BuildConfig.VERSION_NAME;
    private static final String PREFS = "classboard";
    private static final int JOB_ID = 4101;
    private static final int MAX_SEEN = 800;
    private static final long POLL_THROTTLE_MS = 60_000L;

    private Notifier() {}

    static void schedule(Context context) {
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
                    .setPeriodic(15 * 60 * 1000L)
                    .build();
            scheduler.schedule(info);
        } catch (Throwable t) {
            Log.w("classboard", "JobScheduler unavailable", t);
        }
    }

    static void refreshAsync(final Context context) {
        new Thread(() -> {
            try { refresh(context); } catch (Throwable ignored) {}
        }).start();
    }

    /** 拉取一次通知列表，把新通知发成本地系统通知。 */
    static void refresh(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        long now = System.currentTimeMillis();
        if (now - prefs.getLong("last_poll_ms", 0L) < POLL_THROTTLE_MS) return;
        prefs.edit().putLong("last_poll_ms", now).apply();
        Updater.checkInBackground(context);  // 版本检查与登录状态无关
        String cookie = cookie(context);
        if (cookie == null || !cookie.contains("cb_session=")) return;
        JSONArray notices = fetchNotices(cookie);
        if (notices == null) return;

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
    }

    private static JSONArray fetchNotices(String cookie) {
        String text = httpGet(API_NOTICES, cookie);
        if (text == null) return null;
        try { return new JSONObject(text).optJSONArray("notices"); } catch (Exception e) { return null; }
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
