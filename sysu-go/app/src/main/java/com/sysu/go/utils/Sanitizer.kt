package com.sysu.go.utils

object Sanitizer {
    private val DANGEROUS_CHARS = Regex("[<>&\"|'\\\\;/]")

    fun sanitize(input: String?, maxLen: Int = 50): String {
        if (input.isNullOrBlank()) return ""
        return input
            .replace(DANGEROUS_CHARS, "")
            .replace(Regex("\\s+"), " ") // Keep spaces for multi-part names like "Dela Cruz"
            .trim()
            .take(maxLen)
            .split(" ")                                              // Split into words
            .joinToString(" ") { it.lowercase().replaceFirstChar { it.uppercase() } } // Title case each word
    }

    fun sanitizeMI(input: String?): String {
        if (input.isNullOrBlank()) return ""
        return input.trim().uppercase().take(1) // returns "P" — display layers add "."
    }

    fun sanitizePlatePrefix(input: String?): String {
        return input
            ?.uppercase()
            ?.filter { it in 'A'..'Z' }
            ?.take(3)
            ?: ""
    }

    fun sanitizePlateSuffix(input: String?): String {
        return input?.filter { it.isDigit() }?.take(4) ?: ""
    }

    fun sanitizePhone(input: String?): String {
        if (input.isNullOrBlank()) return ""
        //  Keep only digits and leading +
        return input.filter { it.isDigit() || it == '+' }.take(15)
    }

    fun sanitizeName(input: String?): String {
        return sanitize(input, 50)
    }

    /**
     * Cleans a driver's display name for UI surface use.
     * Repairs legacy data written before [sanitizeMI] was introduced:
     *  - Collapses 2+ consecutive dots into a single dot ("Carlos B.. Locar" → "Carlos B. Locar").
     *  - Squashes runs of whitespace into a single space.
     *  - Trims leading/trailing whitespace, plus a stray trailing dot.
     * Returns the original blank string untouched (so callers' fallbacks stay intact).
     */
    fun sanitizeDisplayName(input: String?): String {
        if (input.isNullOrBlank()) return input ?: ""
        return input
            .replace(Regex("\\.{2,}"), ".")
            .replace(Regex(" {2,}"), " ")
            .trim()
            .trimEnd { it == '.' }
    }

    /**
     * Strips forwarder codes, truck company numbers, and ID-style prefixes from a
     * trucking company name so only the human-readable company name remains.
     *
     * Normalizes:
     *   "001-LAZADA SHIPPING COMPANY" → "LAZADA SHIPPING COMPANY"
     *   "045—ABC FORWARDERS Inc"      → "ABC FORWARDERS INC"
     *   "JR&R DISTRIBUTORS Inc."     → "JR&R DISTRIBUTORS INC"
     *   "12345 - ACME LOGISTICS"      → "ACME LOGISTICS"
     *
     * Strategy:
     *   1. If the value starts with a digit sequence (with optional whitespace/dash),
     *      strip that prefix.
     *   2. Uppercase the result.
     *   3. Trim whitespace and trailing dots/dashes.
     */
    fun sanitizeCompanyName(input: String?): String {
        if (input.isNullOrBlank()) return ""
        return input
            .replace(Regex("""^\d+\s*[-—–]+\s*"""), "")  // strip "001-" / "045 — " prefix
            .replace(Regex("""^\d+\s+"""), "")            // strip raw "12345 ACME"
            .trim()
            .trimEnd { it == '.' || it == '-' || it == '—' }
            .uppercase()
            .ifBlank { input.trim().uppercase() }          // fallback: still uppercase
    }
}