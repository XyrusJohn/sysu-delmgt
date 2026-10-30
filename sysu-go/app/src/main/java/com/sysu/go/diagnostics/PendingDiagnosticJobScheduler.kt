package com.sysu.go.diagnostics

import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context

internal object PendingDiagnosticJobScheduler {
    private const val JOB_ID = 731042

    fun schedule(context: Context, delayMs: Long = 0L): Boolean {
        val scheduler = context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as? JobScheduler ?: return false
        val builder = JobInfo.Builder(JOB_ID, ComponentName(context, PendingDiagnosticJobService::class.java))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPersisted(true)
        if (delayMs > 0) builder.setMinimumLatency(delayMs)
        return scheduler.schedule(builder.build()) == JobScheduler.RESULT_SUCCESS
    }

    fun cancel(context: Context) {
        (context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as? JobScheduler)?.cancel(JOB_ID)
    }
}
