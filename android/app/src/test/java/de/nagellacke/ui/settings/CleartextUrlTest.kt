package de.nagellacke.ui.settings

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Guards both the settings warning and the save-time confirmation. Anything this
 * misses connects over plain HTTP without the user ever being told.
 */
class CleartextUrlTest {

    @Test
    fun `a plain http url is cleartext`() {
        assertTrue(isCleartextUrl("http://192.168.1.50:3000"))
    }

    @Test
    fun `an https url is not cleartext`() {
        assertFalse(isCleartextUrl("https://nagellack.familie-schran.de"))
    }

    // Both of these connect fine but slipped past the original
    // `startsWith("http://")` check, leaving the user unwarned.
    @Test
    fun `uppercase scheme is still cleartext`() {
        assertTrue(isCleartextUrl("HTTP://192.168.1.50"))
        assertTrue(isCleartextUrl("Http://192.168.1.50"))
    }

    @Test
    fun `leading whitespace does not hide a cleartext url`() {
        assertTrue(isCleartextUrl("  http://192.168.1.50"))
    }

    // "https" starts with "http", so a naive contains/prefix check on "http" alone
    // would flag every secure URL - the trailing "://" in the prefix is what stops that.
    @Test
    fun `https is not mistaken for http`() {
        assertFalse(isCleartextUrl("HTTPS://example.com"))
        assertFalse(isCleartextUrl(" https://example.com "))
    }

    @Test
    fun `an empty or schemeless url is not reported as cleartext`() {
        assertFalse(isCleartextUrl(""))
        assertFalse(isCleartextUrl("   "))
        assertFalse(isCleartextUrl("example.com"))
    }
}
