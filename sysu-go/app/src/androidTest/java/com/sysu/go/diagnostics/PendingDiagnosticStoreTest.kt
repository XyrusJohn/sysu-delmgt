package com.sysu.go.diagnostics

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class PendingDiagnosticStoreTest {
    @Test fun pendingReportSurvivesReopeningPreferences() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val prefs = context.getSharedPreferences("pending-diagnostic-test-${UUID.randomUUID()}", Context.MODE_PRIVATE)
        try {
            val eventId = UUID.randomUUID().toString()
            val report = PendingDiagnosticReport("synthetic-driver", "pod-save", "IOException", eventId,
                "{\"clientEventId\":\"$eventId\",\"platform\":\"android\"}", recovered = true, submitted = true)
            val recovery = report.copy(errorName = "Recovered", recoveryOnly = true)
            assertTrue(PendingDiagnosticStore(prefs).write(listOf(report, recovery)))
            assertEquals(listOf(report, recovery), PendingDiagnosticStore(prefs).read())
            assertTrue(PendingDiagnosticStore(prefs).write(emptyList()))
            assertEquals(emptyList<PendingDiagnosticReport>(), PendingDiagnosticStore(prefs).read())
        } finally {
            prefs.edit().clear().commit()
        }
    }
}
