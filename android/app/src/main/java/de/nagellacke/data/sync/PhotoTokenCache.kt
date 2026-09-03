package de.nagellacke.data.sync

import java.util.concurrent.ConcurrentHashMap

/**
 * Process-wide store for the signed photo access tokens introduced by #269 (the
 * `?t=` credential on every `/photos/` URL).
 *
 * The token used to live in a `@Volatile` field on [ServerAdapter], which looked
 * right but never worked (#297): the adapter that *mints* a token is the short-lived
 * one `SyncManager.syncNow()` builds and discards, while the adapter that *needs* it
 * is a separate throwaway instance `photoResolution()` constructs purely to reach
 * `photoUrl()`. Those two instances never met, so every image URL handed to Coil went
 * out without a `?t=` and the server — correctly — answered 401.
 *
 * Hoisting the token here is what makes the mint on one instance visible to the read
 * on another. It deliberately stays in memory: persisting a photo credential is
 * exactly what #269 set out to stop, so the tokens die with the process and the next
 * sync mints fresh ones.
 *
 * Entries are keyed by server URL, so pointing the app at a different server can
 * never reuse the first server's token. Switching *accounts* on the same server is
 * not covered by the key — [clear] is called on connect and disconnect for that.
 *
 * @param now injectable clock; the default is the real one, tests supply their own.
 */
internal class PhotoTokenCache(private val now: () -> Long = System::currentTimeMillis) {

    private data class Entry(val token: String, val expiresAt: Long)

    private val entries = ConcurrentHashMap<String, Entry>()

    /**
     * The usable token for [key], or null when there is none or it has expired.
     *
     * Note this is expiry, not the refresh margin: a token inside its margin is still
     * perfectly valid to send, it is merely due for renewal. Applying the margin here
     * too would blank out image URLs for the last minute of every token's life.
     */
    fun get(key: String): String? {
        val entry = entries[key] ?: return null
        if (now() >= entry.expiresAt) {
            // Drop it rather than let dead entries accumulate for servers no longer in use.
            entries.remove(key, entry)
            return null
        }
        return entry.token
    }

    /**
     * True when [key] has no token, or its remaining life is under [marginMs] — the
     * caller should mint a new one. The margin exists so a screen full of photos never
     * races an expiry that lands mid-render.
     */
    fun needsRefresh(key: String, marginMs: Long): Boolean {
        val entry = entries[key] ?: return true
        return now() >= entry.expiresAt - marginMs
    }

    fun put(key: String, token: String, expiresAt: Long) {
        entries.put(key, Entry(token, expiresAt))
    }

    /** Drops every token. Called when the signed-in identity changes. */
    fun clear() {
        entries.clear()
    }

    companion object {
        /**
         * The instance every [ServerAdapter] shares. A singleton is the whole point —
         * separate instances would reproduce #297 exactly.
         */
        val shared = PhotoTokenCache()
    }
}
