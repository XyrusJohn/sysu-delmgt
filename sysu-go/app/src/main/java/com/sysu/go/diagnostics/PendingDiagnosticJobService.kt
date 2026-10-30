package com.sysu.go.diagnostics

import android.app.job.JobParameters
import android.app.job.JobService

class PendingDiagnosticJobService : JobService() {
    override fun onStartJob(params: JobParameters): Boolean {
        SystemErrorReporter.flushPendingReports(this) { jobFinished(params, false) }
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean = true
}
