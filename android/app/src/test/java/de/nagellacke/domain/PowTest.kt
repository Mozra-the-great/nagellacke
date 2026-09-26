package de.nagellacke.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The expected values were computed with Node's crypto, i.e. the same hash the server
 * verifies with (v3/server/src/pow.ts), so a disagreement here is a registration the
 * server would refuse (#324 S13).
 */
class PowTest {
    @Test
    fun `finds the same smallest solution the server-side hash does`() {
        assertEquals(103L, Pow.solve("fedcba9876543210fedcba9876543210", 8))
        assertEquals(3567L, Pow.solve("00000000000000000000000000000000", 12))
    }

    @Test
    fun `counts leading zero bits across a byte boundary, with signed bytes`() {
        assertTrue(Pow.hasLeadingZeroBits(byteArrayOf(0, 0x0f), 12))
        assertFalse(Pow.hasLeadingZeroBits(byteArrayOf(0, 0x10), 12))
        // 0x80 is negative as a Kotlin Byte; a signed shift would read it as all ones.
        assertFalse(Pow.hasLeadingZeroBits(byteArrayOf(0x80.toByte()), 1))
        assertTrue(Pow.hasLeadingZeroBits(byteArrayOf(0x7f), 1))
        assertTrue(Pow.hasLeadingZeroBits(byteArrayOf(0, 0), 16))
    }
}
