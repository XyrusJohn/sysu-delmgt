package com.sysu.go

import android.content.Intent
import android.widget.EditText
import android.widget.TextView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.sysu.go.activities.RegistrationActivity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class RegistrationFlowInstrumentedTest {
    @Test
    fun passwordBoundaryKeepsInvalidDetailsEditableAndAcceptsEightCharacters() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val intent = Intent(instrumentation.targetContext, RegistrationActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val activity = instrumentation.startActivitySync(intent) as RegistrationActivity
        try {
            instrumentation.runOnMainSync {
                activity.findViewById<EditText>(R.id.etLastName).setText("Test")
                activity.findViewById<EditText>(R.id.etFirstName).setText("Driver")
                activity.findViewById<EditText>(R.id.etPhone).setText("09123456789")
                activity.findViewById<EditText>(R.id.actvTruckCompany).setText("Synthetic Logistics")
                activity.findViewById<EditText>(R.id.etUsername).setText("test.driver")
                val password = activity.findViewById<EditText>(R.id.etAccountPassword)
                val continueButton = activity.findViewById<TextView>(R.id.btnContinue)
                val initialLabel = continueButton.text.toString()

                password.setText("1234567")
                continueButton.performClick()
                assertNotNull(password.error)
                assertEquals(initialLabel, continueButton.text.toString())
                assertEquals(true, password.isEnabled)

                password.setText("12345678")
                continueButton.performClick()
                assertNull(password.error)
                assertEquals(activity.getString(R.string.register_confirm), continueButton.text.toString())
                assertEquals(false, password.isEnabled)
            }
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
        }
    }
}
