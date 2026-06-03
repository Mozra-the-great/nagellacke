package de.nagellacke.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ColorTest {
    @Test fun `red hue is 0`() = assertEquals(0, hexToHue("#ff0000"))
    @Test fun `green hue is 120`() = assertEquals(120, hexToHue("#00ff00"))
    @Test fun `blue hue is 240`() = assertEquals(240, hexToHue("#0000ff"))
    @Test fun `invalid hex returns 0`() = assertEquals(0, hexToHue("notahex"))
    @Test fun `short hex returns 0`() = assertEquals(0, hexToHue("#fff"))
    @Test fun `valid hex passes`() = assertTrue(isValidHex("#ff6699"))
    @Test fun `invalid hex fails`() = assertFalse(isValidHex("xyz"))
}
