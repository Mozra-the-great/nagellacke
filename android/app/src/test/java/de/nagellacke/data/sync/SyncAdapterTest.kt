package de.nagellacke.data.sync

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Mirrors the server's own mapping in v3/server/src/index.ts:441 — if the two ever
 * drift apart, an upload lands under a filename whose extension contradicts the
 * Content-Type the same request sends.
 */
class SyncAdapterTest {

    @Test
    fun `png mime type maps to png extension`() {
        assertEquals("png", extensionForMimeType("image/png"))
    }

    @Test
    fun `webp mime type maps to webp extension`() {
        assertEquals("webp", extensionForMimeType("image/webp"))
    }

    // jpeg reaches "jpg" through the else branch rather than an explicit arm, so it
    // is worth asserting: a later edit to the fallback would silently change it.
    @Test
    fun `jpeg maps to jpg`() {
        assertEquals("jpg", extensionForMimeType("image/jpeg"))
    }

    @Test
    fun `unknown mime types fall back to jpg`() {
        assertEquals("jpg", extensionForMimeType("application/octet-stream"))
        assertEquals("jpg", extensionForMimeType(""))
    }

    // The match is exact, not a prefix or case-insensitive one. Every caller passes a
    // value produced by mimeTypeFromFilename()/the photo picker, which emit lowercase
    // canonical types, so this documents the boundary rather than asking for a change.
    @Test
    fun `matching is exact, so uppercase and parameterised types use the fallback`() {
        assertEquals("jpg", extensionForMimeType("IMAGE/PNG"))
        assertEquals("jpg", extensionForMimeType("image/png; charset=binary"))
    }
}
