package com.sysu.go.diagnostics

internal fun diagnosticsPersistenceFailureCode(responseCode: Int): String = when (responseCode) {
    400 -> "INVALID_DIAGNOSTICS"
    401 -> "SESSION_EXPIRED"
    403 -> "ACCOUNT_NOT_ALLOWED"
    429 -> "RATE_LIMITED"
    in 500..599 -> "SERVER_UNAVAILABLE"
    else -> "REPORT_NOT_SAVED"
}

internal fun diagnosticsNetworkFailureCode(error: Exception, timeoutCode: String): String = when {
    error.message == "Unsafe diagnostics API URL" -> "UNSAFE_API_CONFIGURATION"
    error is java.net.SocketTimeoutException -> timeoutCode
    error is java.net.UnknownHostException -> "API_HOST_NOT_FOUND"
    error is javax.net.ssl.SSLException -> "SECURE_CONNECTION_FAILED"
    error is java.net.ConnectException -> "API_CONNECTION_FAILED"
    error is java.net.SocketException && error.message?.contains("network is unreachable", ignoreCase = true) == true -> "NETWORK_UNREACHABLE"
    error is java.net.SocketException && error.message?.contains("no route to host", ignoreCase = true) == true -> "NETWORK_UNREACHABLE"
    error is java.io.IOException -> "API_REQUEST_FAILED"
    else -> "REPORT_NOT_SAVED"
}
