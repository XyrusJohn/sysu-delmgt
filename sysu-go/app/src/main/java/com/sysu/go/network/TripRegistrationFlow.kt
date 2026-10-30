package com.sysu.go.network

/** Queue admission is provisional until the backend confirms registration. */
object TripRegistrationFlow {
    sealed class Result {
        data class Success(val queueId: String) : Result()
        data class Error(val code: Int, val message: String) : Result()
    }

    suspend fun run(
        existingQueueId: String?,
        admit: suspend () -> Result,
        register: suspend (String) -> Result,
        onAdmitted: (String) -> Unit,
        confirmCommitted: suspend (String) -> Boolean = { false }
    ): Result {
        val queueId = if (!existingQueueId.isNullOrBlank()) existingQueueId else {
            when (val admission = admit()) {
                is Result.Error -> return admission
                is Result.Success -> {
                    if (admission.queueId.isBlank()) return Result.Error(502, "Invalid admission response")
                    onAdmitted(admission.queueId)
                    admission.queueId
                }
            }
        }
        val result = register(queueId)
        //  A lost HTTP response must not turn a server-confirmed registration into a failure.
        if (result is Result.Error && (result.code == -1 || result.code >= 500 || result.code == 409) &&
            confirmCommitted(queueId)) return Result.Success(queueId)
        return result
    }
}
