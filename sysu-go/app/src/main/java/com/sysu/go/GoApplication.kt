package com.sysu.go

import android.app.Application

/** Application singleton. Runs before any Activity. */
class GoApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        com.sysu.go.diagnostics.SystemErrorReporter.install(this)
        com.sysu.go.diagnostics.UserErrorNotifier.install(this)
        com.sysu.go.config.EnvironmentPolicy.validate(
            BuildConfig.USE_LOCAL_SERVICES,
            BuildConfig.API_BASE_URL,
            BuildConfig.SOCKET_URL
        )
        com.sysu.go.utils.StrictPermissionMonitor.initialize(this)
    }
}
