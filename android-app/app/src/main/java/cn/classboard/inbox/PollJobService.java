package cn.classboard.inbox;

import android.app.job.JobParameters;
import android.app.job.JobService;

public class PollJobService extends JobService {
    @Override
    public boolean onStartJob(final JobParameters params) {
        new Thread(() -> {
            try {
                Notifier.refresh(PollJobService.this, "job");
                Notifier.ensureService(PollJobService.this);
            } catch (Throwable ignored) {
            } finally {
                jobFinished(params, false);
            }
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;
    }
}
