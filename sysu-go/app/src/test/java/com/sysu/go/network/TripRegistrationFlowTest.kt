package com.sysu.go.network

import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class TripRegistrationFlowTest {
    @Test fun lostResponseUsesAuthoritativeConfirmation() = runBlocking {
        for (code in listOf(-1, 500, 409)) {
            val result = TripRegistrationFlow.run("queue-a", admit = { error("Already admitted") },
                register = { TripRegistrationFlow.Result.Error(code, "Response lost") },
                onAdmitted = {}, confirmCommitted = { it == "queue-a" })
            assertEquals(TripRegistrationFlow.Result.Success("queue-a"), result)
        }
    }

    @Test fun permissionFailuresCannotBeOverriddenByConfirmation() = runBlocking {
        for (code in listOf(400, 401, 403, 404)) {
            val failure = TripRegistrationFlow.Result.Error(code, "Denied")
            val result = TripRegistrationFlow.run("queue-a", admit = { error("Already admitted") },
                register = { failure }, onAdmitted = {}, confirmCommitted = { error("Must not reconcile denial") })
            assertEquals(failure, result)
        }
    }
    @Test fun admissionMustContinueToRegistrationBeforeSuccess() = runBlocking {
        val events = mutableListOf<String>()
        val result = TripRegistrationFlow.run(null,
            admit = { events.add("admit"); TripRegistrationFlow.Result.Success("queue-a") },
            register = { id -> events.add("register:$id"); TripRegistrationFlow.Result.Success(id) },
            onAdmitted = { id -> events.add("saved:$id") })
        assertEquals(listOf("admit", "saved:queue-a", "register:queue-a"), events)
        assertEquals(TripRegistrationFlow.Result.Success("queue-a"), result)
    }

    @Test fun registrationFailuresCannotBecomeConfirmationSuccess() = runBlocking {
        for (code in listOf(401, 403, 409, 500, -1)) {
            var saved: String? = null
            val failure = TripRegistrationFlow.Result.Error(code, "Registration failed")
            val result = TripRegistrationFlow.run(null,
                admit = { TripRegistrationFlow.Result.Success("queue-a") },
                register = { failure }, onAdmitted = { saved = it })
            assertEquals(failure, result)
            assertEquals("queue-a", saved)
        }
    }

    @Test fun savedQueueRetryDoesNotConsumeQrAgain() = runBlocking {
        val result = TripRegistrationFlow.run("queue-a",
            admit = { throw AssertionError("QR admission repeated") },
            register = { TripRegistrationFlow.Result.Success(it) },
            onAdmitted = { throw AssertionError("Existing queue admitted again") })
        assertEquals(TripRegistrationFlow.Result.Success("queue-a"), result)
    }

    @Test fun admissionDenialCannotRegisterOrSaveQueue() = runBlocking {
        val failure = TripRegistrationFlow.Result.Error(401, "Please sign in again")
        val result = TripRegistrationFlow.run(null, admit = { failure },
            register = { throw AssertionError("Unauthorized registration") },
            onAdmitted = { throw AssertionError("Unauthorized queue saved") })
        assertEquals(failure, result)
    }

    @Test fun missingQueueIdentityCannotRegister() = runBlocking {
        val result = TripRegistrationFlow.run(null,
            admit = { TripRegistrationFlow.Result.Success("") },
            register = { throw AssertionError("Missing queue registered") },
            onAdmitted = { throw AssertionError("Missing queue saved") })
        assertTrue(result is TripRegistrationFlow.Result.Error)
    }
}
