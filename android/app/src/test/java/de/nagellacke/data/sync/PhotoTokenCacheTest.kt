package de.nagellacke.data.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #297: the photo token used to be a field on ServerAdapter, so the instance that
 * minted it (sync) and the instance that read it (photoUrl, on the throwaway adapter
 * built for display) were never the same object — every image URL went out unsigned.
 *
 * These tests pin the property that fixes it: a write through one holder of the cache
 * is visible to a read through another.
 */
class PhotoTokenCacheTest {

    private val server = "https://nagellacke.example"

    @Test
    fun `a token stored via one reference is visible through another`() {
        val cache = PhotoTokenCache(now = { 1_000L })
        // Stands in for the two adapter instances: SyncManager's, and the one
        // photoResolution() builds purely to call photoUrl().
        val minter: PhotoTokenCache = cache
        val reader: PhotoTokenCache = cache

        minter.put(server, "signed-token", expiresAt = 60_000L)

        assertEquals("signed-token", reader.get(server))
    }

    @Test
    fun `a token for one server is never served for another`() {
        val cache = PhotoTokenCache(now = { 1_000L })
        cache.put(server, "signed-token", expiresAt = 60_000L)

        assertNull(cache.get("https://someone-elses.example"))
    }

    @Test
    fun `an expired token is not handed out`() {
        var now = 1_000L
        val cache = PhotoTokenCache(now = { now })
        cache.put(server, "signed-token", expiresAt = 5_000L)
        assertEquals("signed-token", cache.get(server))

        now = 5_000L
        assertNull(cache.get(server))
    }

    /**
     * get() applies expiry, not the refresh margin. Blanking a token out for the last
     * minute of its life would strip `?t=` from every image URL in that window even
     * though the server would still have accepted it.
     */
    @Test
    fun `a token inside the refresh margin is still served`() {
        val cache = PhotoTokenCache(now = { 100_000L })
        cache.put(server, "signed-token", expiresAt = 130_000L)

        assertTrue(cache.needsRefresh(server, marginMs = 60_000L))
        assertEquals("signed-token", cache.get(server))
    }

    @Test
    fun `needsRefresh is true when nothing is cached`() {
        val cache = PhotoTokenCache(now = { 1_000L })
        assertTrue(cache.needsRefresh(server, marginMs = 60_000L))
    }

    @Test
    fun `needsRefresh is false for a token well inside its life`() {
        val cache = PhotoTokenCache(now = { 1_000L })
        cache.put(server, "signed-token", expiresAt = 3_600_000L)

        assertFalse(cache.needsRefresh(server, marginMs = 60_000L))
    }

    /** Switching accounts on the same server must not reuse the previous token. */
    @Test
    fun `clear drops every token`() {
        val cache = PhotoTokenCache(now = { 1_000L })
        cache.put(server, "signed-token", expiresAt = 3_600_000L)
        cache.put("https://other.example", "other-token", expiresAt = 3_600_000L)

        cache.clear()

        assertNull(cache.get(server))
        assertNull(cache.get("https://other.example"))
        assertTrue(cache.needsRefresh(server, marginMs = 60_000L))
    }

    @Test
    fun `a fresh token replaces the one it renews`() {
        val cache = PhotoTokenCache(now = { 1_000L })
        cache.put(server, "old-token", expiresAt = 2_000L)
        cache.put(server, "new-token", expiresAt = 3_600_000L)

        assertEquals("new-token", cache.get(server))
    }
}
