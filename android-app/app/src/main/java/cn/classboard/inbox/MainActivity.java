package cn.classboard.inbox;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStreamReader;

public class MainActivity extends Activity {
    static final String EXTRA_INSTALL = "cn.classboard.inbox.install";
    private static final String SITE_HOST = "classboard-upc.pages.dev";
    private static final String TAG = "classboard";
    private static final int BG_LIGHT = 0xFFF6F8FC;
    private static final int BG_DARK = 0xFF0D1526;
    private FrameLayout root;
    private WebView webView;
    private boolean softwareMode;
    private boolean errorShown;
    private boolean themeDark;
    private boolean pendingInstall;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        root = new FrameLayout(this);
        setContentView(root);
        applyInsets();
        applyTheme(isNight());
        // 上次启动崩过：这次用软件渲染、不注册后台任务，先把界面跑起来
        final boolean safeMode = crashReport() != null;
        softwareMode = safeMode;
        showPreviousCrash();
        if (!buildWebView()) return;
        loadSite(state, !safeMode);
        if (safeMode) return;
        try { requestNotificationPermission(); } catch (Throwable ignored) {}
        try { Notifier.schedule(this); } catch (Throwable t) { Log.w(TAG, "schedule failed", t); }
        try { Notifier.refreshAsync(this); } catch (Throwable ignored) {}
        try { Updater.checkAsync(this, this::onUpdateReady); } catch (Throwable ignored) {}
        handleIntent(getIntent());
    }

    /** 安卓 15 起系统强制边到边绘制，整页会顶到状态栏下面：按系统给的 inset 留白。 */
    @SuppressWarnings("deprecation")
    private void applyInsets() {
        try {
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                int left, top, right, bottom;
                if (Build.VERSION.SDK_INT >= 30) {
                    Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                    Insets ime = insets.getInsets(WindowInsets.Type.ime());
                    left = bars.left;
                    top = bars.top;
                    right = bars.right;
                    bottom = Math.max(bars.bottom, ime.bottom);
                } else {
                    left = insets.getSystemWindowInsetLeft();
                    top = insets.getSystemWindowInsetTop();
                    right = insets.getSystemWindowInsetRight();
                    bottom = insets.getSystemWindowInsetBottom();
                }
                if (view.getPaddingTop() != top || view.getPaddingBottom() != bottom
                        || view.getPaddingLeft() != left || view.getPaddingRight() != right) {
                    view.setPadding(left, top, right, bottom);
                }
                // 留白由原生负责：把已处理的边衬区标记为 NONE，不再传给网页，避免重复留空
                if (Build.VERSION.SDK_INT >= 30) {
                    return new WindowInsets.Builder(insets)
                            .setInsets(WindowInsets.Type.systemBars(), Insets.NONE)
                            .setInsets(WindowInsets.Type.ime(), Insets.NONE)
                            .build();
                }
                insets.consumeSystemWindowInsets();
                return insets;
            });
            root.requestApplyInsets();
        } catch (Throwable t) {
            Log.w(TAG, "insets unavailable", t);
        }
    }

    /** 网页主题同步过来：留白区域颜色和状态栏图标明暗跟着一起变。 */
    private void applyTheme(boolean dark) {
        themeDark = dark;
        int bg = themeDark ? BG_DARK : BG_LIGHT;
        try { root.setBackgroundColor(bg); } catch (Throwable ignored) {}
        try { if (webView != null) webView.setBackgroundColor(bg); } catch (Throwable ignored) {}
        applyBars();
    }

    private void applyBars() {
        try {
            if (Build.VERSION.SDK_INT >= 35) {
                // 边到边模式下状态栏 / 导航栏是透明的，图标明暗得自己定
                WindowInsetsController controller = getWindow().getInsetsController();
                if (controller != null) {
                    int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                    controller.setSystemBarsAppearance(themeDark ? 0 : mask, mask);
                }
            } else if (Build.VERSION.SDK_INT >= 26) {
                getWindow().setNavigationBarColor(themeDark ? BG_DARK : 0xFFFFFFFF);
                getWindow().getDecorView().setSystemUiVisibility(
                        themeDark ? 0 : View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
            } else {
                getWindow().setNavigationBarColor(0xFF203458);
            }
        } catch (Throwable ignored) {}
    }

    private boolean buildWebView() {
        try {
            webView = new WebView(this);
            errorShown = false;
            webView.setBackgroundColor(themeDark ? BG_DARK : BG_LIGHT);
            if (softwareMode) webView.setLayerType(View.LAYER_TYPE_SOFTWARE, null);
            WebSettings settings = webView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            // 手机系统字体放大时 WebView 会同步放大网页文字，与浏览器渲染不一致导致换行错乱：锁定 100%
            settings.setTextZoom(100);
            settings.setUserAgentString(settings.getUserAgentString() + " ClassboardApp/" + BuildConfig.VERSION_NAME);
            try { CookieManager.getInstance().setAcceptCookie(true); } catch (Throwable ignored) {}
            webView.addJavascriptInterface(new Bridge(), "AndroidApp");
            webView.setWebChromeClient(new WebChromeClient());
            webView.setWebViewClient(new Client());
            root.addView(webView, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            // 崩溃提示层可能先于 WebView 添加，这里把它重新提到最上层
            for (int i = 0; i < root.getChildCount(); i++) {
                View child = root.getChildAt(i);
                if (child != webView) child.bringToFront();
            }
            try { WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG); } catch (Throwable ignored) {}
            return true;
        } catch (Throwable t) {
            // WebView 组件缺失或损坏时，给一个能看懂的提示，而不是黑屏后闪退
            Log.e(TAG, "WebView unavailable", t);
            new Overlay("无法打开网页", "这台设备的 WebView 组件不可用或已被停用。\n"
                    + "请在系统设置或应用商店里启用 / 更新「Android System WebView」（或 Chrome），"
                    + "也可以用下面的按钮先用系统浏览器打开。\n\n" + t)
                    .button("用浏览器打开", this::openInBrowser)
                    .button("知道了", null)
                    .show();
            return false;
        }
    }

    private void loadSite(Bundle state, boolean restore) {
        try {
            if (restore && state != null && webView.restoreState(state) != null) return;
        } catch (Throwable ignored) {
        }
        try { webView.loadUrl(Notifier.SITE); } catch (Throwable ignored) {}
    }

    private final class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return openUrl(request.getUrl());
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            Notifier.syncCookie(MainActivity.this, Notifier.SITE);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame() || errorShown) return;
            errorShown = true;
            showLoadError(error.getDescription() + "（错误码 " + error.getErrorCode() + "）");
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // 渲染进程崩溃时系统默认会连 App 一起杀掉（表现为黑屏后闪退），这里重建 WebView
            Log.w(TAG, "render process gone, crashed=" + detail.didCrash());
            root.removeAllViews();
            try { view.destroy(); } catch (Throwable ignored) {}
            webView = null;
            softwareMode = true;
            if (buildWebView()) loadSite(null, false);
            return true;
        }
    }

    private boolean openUrl(Uri uri) {
        // 只有班级站本身留在 WebView 里：这里注入了 AndroidApp 桥，任何别的站点都必须交给系统浏览器。
        // 注意不能用 endsWith("pages.dev")，那会放行 evilpages.dev 和任意 *.pages.dev 项目。
        String host = uri.getHost();
        if (SITE_HOST.equalsIgnoreCase(host)) return false;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Throwable ignored) {
        }
        return true;
    }

    private void openInBrowser() {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(Notifier.SITE)));
        } catch (Throwable ignored) {
        }
    }

    // ---- 自动更新：后台下载好，应用内一键装 ----

    private void handleIntent(Intent intent) {
        if (intent == null || !intent.getBooleanExtra(EXTRA_INSTALL, false)) return;
        intent.removeExtra(EXTRA_INSTALL);
        installUpdate();
    }

    private void onUpdateReady(String version) {
        if (version == null || Updater.isSkipped(this)) return;
        showUpdateOverlay(version);
    }

    private void showUpdateOverlay(String version) {
        final Overlay overlay = new Overlay("发现新版本 " + version,
                "新版本已自动下载完成，点「立即安装」交给系统安装，登录状态会自动保留。\n\n"
                        + "若系统提示「禁止安装未知应用」，请在随后弹出的设置页里允许「知可而办」安装应用，"
                        + "返回后会自动继续安装。");
        overlay.button("立即安装", () -> {
            overlay.dismiss();
            installUpdate();
        });
        overlay.button("稍后", () -> {
            Updater.skip(this);
            overlay.dismiss();
        });
        overlay.show();
    }

    private void installUpdate() {
        if (!Updater.ready(this)) {
            Updater.checkAsync(this, this::onUpdateReady);
            return;
        }
        if (!Updater.canInstall(this)) {
            pendingInstall = true;
            Toast.makeText(this, "请在设置里允许「知可而办」安装应用", Toast.LENGTH_LONG).show();
            Updater.requestInstallPermission(this);
            return;
        }
        Updater.install(this);
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 1);
        }
    }

    // ---- 出错时的兜底界面：任何情况下都不留黑屏 ----

    private void showLoadError(String reason) {
        final Overlay overlay = new Overlay("网页打不开", "可能是网络不通（校园网或移动网络限制）或网站暂时不可用。\n\n" + reason);
        overlay.button("重试", () -> {
            overlay.dismiss();
            if (webView != null) webView.reload();
        });
        overlay.button("兼容模式重试", () -> {
            overlay.dismiss();
            softwareMode = true;
            if (webView != null) {
                webView.setLayerType(View.LAYER_TYPE_SOFTWARE, null);
                webView.reload();
            }
        });
        overlay.show();
    }

    private String crashReport() {
        File file = new File(getFilesDir(), App.CRASH_FILE);
        if (!file.exists()) return null;
        StringBuilder text = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(new FileInputStream(file), "UTF-8"))) {
            String line;
            while ((line = reader.readLine()) != null && text.length() < 4000) text.append(line).append('\n');
        } catch (Throwable ignored) {
        }
        return text.length() == 0 ? null : text.toString();
    }

    private void showPreviousCrash() {
        final String report = crashReport();
        if (report == null) return;
        try { new File(getFilesDir(), App.CRASH_FILE).delete(); } catch (Throwable ignored) {}  // 只提示一次
        final Overlay overlay = new Overlay("上次打开时出现错误",
                report + "\n本次已自动切换到兼容模式。把这段内容截图发给维护者即可定位问题。");
        overlay.button("复制", () -> {
            try {
                ((ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("crash", report));
                Toast.makeText(this, "已复制", Toast.LENGTH_SHORT).show();
            } catch (Throwable ignored) {
            }
        });
        overlay.button("用浏览器打开", () -> {
            overlay.dismiss();
            openInBrowser();
        });
        overlay.button("继续", null);
        overlay.show();
    }

    private final class Overlay {
        private final LinearLayout box;
        private final LinearLayout row;
        private final int pad = Math.round(20 * getResources().getDisplayMetrics().density);

        Overlay(String title, String text) {
            box = new LinearLayout(MainActivity.this);
            box.setOrientation(LinearLayout.VERTICAL);
            box.setBackgroundColor(getColor(isNight() ? R.color.navBar : R.color.windowBackground));
            box.setPadding(pad, pad, pad, pad);

            TextView heading = new TextView(MainActivity.this);
            heading.setText(title);
            heading.setTextSize(18);
            heading.setTextColor(isNight() ? 0xFFE8EEF9 : 0xFF1B2434);
            box.addView(heading);

            TextView body = new TextView(MainActivity.this);
            body.setText(text);
            body.setTextSize(13);
            body.setTextIsSelectable(true);
            body.setPadding(0, pad / 2, 0, pad / 2);
            body.setTextColor(isNight() ? 0xFF9FB0CC : 0xFF5A6B85);
            ScrollView scroll = new ScrollView(MainActivity.this);
            scroll.addView(body);
            box.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

            row = new LinearLayout(MainActivity.this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(Gravity.END);
            box.addView(row);
        }

        Overlay button(String label, Runnable action) {
            Button button = new Button(MainActivity.this);
            button.setText(label);
            button.setAllCaps(false);
            button.setOnClickListener(v -> {
                if (action != null) action.run();
                else dismiss();
            });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
            if (row.getChildCount() > 0) lp.leftMargin = pad / 2;
            row.addView(button, lp);
            return this;
        }

        void show() {
            root.addView(box, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }

        void dismiss() {
            root.removeView(box);
        }
    }

    private boolean isNight() {
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        try { Notifier.refreshAsync(this); } catch (Throwable ignored) {}
        handleIntent(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        // 从「安装未知应用」授权页回来：自动继续安装
        if (pendingInstall && Updater.canInstall(this)) {
            pendingInstall = false;
            Updater.install(this);
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        try { if (webView != null) webView.saveState(outState); } catch (Throwable ignored) {}
    }

    @Override
    protected void onDestroy() {
        try { if (webView != null) webView.destroy(); } catch (Throwable ignored) {}
        super.onDestroy();
    }

    /** 网页通过 JS 桥调用，异常必须自己吞掉：桥线程抛异常会连累整个进程。 */
    class Bridge {
        @JavascriptInterface
        public void notify(String id, String title, String body) {
            try { Notifier.notifyFromWeb(MainActivity.this, id, title, body); } catch (Throwable t) { Log.w(TAG, "bridge notify failed", t); }
        }

        @JavascriptInterface
        public String version() {
            try { return BuildConfig.VERSION_NAME; } catch (Throwable ignored) { return ""; }
        }

        @JavascriptInterface
        public void theme(String mode) {
            try { runOnUiThread(() -> applyTheme("dark".equals(mode))); } catch (Throwable ignored) {}
        }

        /** 网页里的「检查更新」按钮：发现新版本就直接弹安装框，否则提示已是最新。 */
        @JavascriptInterface
        public void checkUpdate() {
            try {
                runOnUiThread(() -> Updater.checkAsync(MainActivity.this, version -> {
                    if (version != null) showUpdateOverlay(version);
                    else Toast.makeText(MainActivity.this, "已是最新版本", Toast.LENGTH_SHORT).show();
                }));
            } catch (Throwable ignored) {}
        }
    }
}
