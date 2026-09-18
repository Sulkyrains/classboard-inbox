package cn.classboard.inbox;

import android.app.Application;
import android.os.Build;

import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.io.Writer;

/** 未捕获异常写进 crash.txt，下次打开时由 MainActivity 显示出来。 */
public class App extends Application {
    static final String CRASH_FILE = "crash.txt";

    @Override
    public void onCreate() {
        super.onCreate();
        final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            save(error);
            if (previous != null) previous.uncaughtException(thread, error);
        });
    }

    private void save(Throwable error) {
        try (Writer writer = new OutputStreamWriter(openFileOutput(CRASH_FILE, MODE_PRIVATE), "UTF-8")) {
            writer.write("知可而办 " + BuildConfig.VERSION_NAME + " · Android " + Build.VERSION.RELEASE + " · " + Build.MODEL + "\n\n");
            error.printStackTrace(new PrintWriter(writer));
            writer.flush();
        } catch (Throwable ignored) {
        }
    }
}
