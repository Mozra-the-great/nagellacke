package de.nagellacke.domain

import org.junit.Assert.assertEquals
import org.junit.Test

class ColorFromPhotoTest {
    @Test fun `argbToHex extracts RGB and ignores alpha`() {
        // 0xFFFF6699 = opaque, r=0xFF, g=0x66, b=0x99
        assertEquals("#FF6699", argbToHex(0xFFFF6699.toInt()))
    }

    @Test fun `argbToHex handles black and white`() {
        assertEquals("#000000", argbToHex(0xFF000000.toInt()))
        assertEquals("#FFFFFF", argbToHex(0xFFFFFFFF.toInt()))
    }

    @Test fun `mapToBitmapPixel scales center tap to bitmap center`() {
        val (x, y) = mapToBitmapPixel(50f, 25f, 100f, 50f, 200, 100)
        assertEquals(100, x)
        assertEquals(50, y)
    }

    @Test fun `mapToBitmapPixel clamps to bitmap bounds at the edges`() {
        val (x1, y1) = mapToBitmapPixel(0f, 0f, 100f, 100f, 50, 50)
        assertEquals(0, x1); assertEquals(0, y1)
        val (x2, y2) = mapToBitmapPixel(100f, 100f, 100f, 100f, 50, 50)
        assertEquals(49, x2); assertEquals(49, y2)
    }

    @Test fun `mapToBitmapPixel handles out-of-bounds offsets by clamping`() {
        val (x, y) = mapToBitmapPixel(-10f, 500f, 100f, 100f, 50, 50)
        assertEquals(0, x); assertEquals(49, y)
    }

    @Test fun `mapToBitmapPixel returns origin for degenerate view size`() {
        assertEquals(0 to 0, mapToBitmapPixel(10f, 10f, 0f, 0f, 50, 50))
    }
}
