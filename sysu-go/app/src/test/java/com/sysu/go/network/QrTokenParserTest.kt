package com.sysu.go.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class QrTokenParserTest {
    @Test
    fun `accepts raw SYS tokens`() {
        assertEquals("SYS-123456789ABC", QrTokenParser.extract("SYS-123456789ABC"))
    }

    @Test
    fun `extracts a token from a URL on any configured frontend origin`() {
        assertEquals(
            "SYS-123456789ABC",
            QrTokenParser.extract(
                "http://localhost:5173/app/scan?source=qr&token=SYS-123456789ABC",
            ),
        )
    }

    @Test
    fun `rejects unsupported schemes malformed URLs and invalid tokens`() {
        assertNull(QrTokenParser.extract("javascript://example/?token=SYS-123456789ABC"))
        assertNull(QrTokenParser.extract("https://user@example/?token=SYS-123456789ABC"))
        assertNull(QrTokenParser.extract("https://example/?token=BAD-123"))
        assertNull(QrTokenParser.extract("not a URL"))
    }
}
