package de.nagellacke.data.sync

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import retrofit2.HttpException

/**
 * The "refresh once, retry once" policy behind ServerAdapter's authenticated calls (#220).
 *
 * Kept separate from ServerAdapter because that class builds its own Retrofit client from the
 * configured server URL, leaving no seam to hand it a fake API — the same reason resolveWithin()
 * lives outside PhotoRepository.
 *
 * [tokenOf] reports the access token currently in effect, [refresh] performs the exchange. Both
 * are supplied by the caller so this holds no state of its own.
 */
internal class AuthRetry(
    private val tokenOf: () -> String,
    private val refresh: suspend () -> Boolean,
) {
    private val mutex = Mutex()

    /**
     * Runs [block]. On a 401, refreshes and retries exactly once — never in a loop: if the retry
     * also 401s, the session is genuinely gone and the caller has to prompt for a new login.
     */
    suspend fun <T> run(block: suspend () -> T): T {
        val tokenBefore = tokenOf()
        return try {
            block()
        } catch (e: HttpException) {
            if (e.code() == 401 && refreshOnce(tokenBefore)) block() else throw e
        }
    }

    /**
     * Serialized, and each waiter re-checks whether the token it saw is still in effect: a sync
     * and a photo upload hitting 401 together would otherwise both redeem the same refresh token.
     * The server rotates it, so the second exchange fails — and that failure is what the user
     * would see, even though the first one had already repaired the session.
     */
    private suspend fun refreshOnce(tokenSeenByCaller: String): Boolean = mutex.withLock {
        if (tokenOf() != tokenSeenByCaller) return true
        refresh()
    }
}
