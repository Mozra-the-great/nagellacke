package de.nagellacke.data.sync

import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response
import java.util.concurrent.atomic.AtomicInteger

class AuthRetryTest {

    private fun httpError(code: Int) =
        HttpException(Response.error<Any>(code, "".toResponseBody("application/json".toMediaType())))

    @Test
    fun `a successful call never refreshes`() = runTest {
        val refreshes = AtomicInteger()
        val retry = AuthRetry(tokenOf = { "t1" }, refresh = { refreshes.incrementAndGet(); true })
        assertEquals("ok", retry.run { "ok" })
        assertEquals(0, refreshes.get())
    }

    @Test
    fun `a 401 refreshes once and retries the call`() = runTest {
        var token = "expired"
        val calls = AtomicInteger()
        val retry = AuthRetry(tokenOf = { token }, refresh = { token = "fresh"; true })

        val result = retry.run {
            if (calls.incrementAndGet() == 1) throw httpError(401)
            token
        }

        assertEquals("fresh", result)
        assertEquals(2, calls.get())
    }

    // One retry, never a loop: if the refreshed token is also rejected the session is genuinely
    // gone, and the caller has to prompt for a new login rather than hammer the server.
    @Test
    fun `a 401 that survives the refresh is thrown instead of retried again`() = runTest {
        val calls = AtomicInteger()
        val retry = AuthRetry(tokenOf = { "t" }, refresh = { true })

        val thrown = assertThrows(HttpException::class.java) {
            kotlinx.coroutines.runBlocking {
                retry.run<Unit> { calls.incrementAndGet(); throw httpError(401) }
            }
        }

        assertEquals(401, thrown.code())
        assertEquals(2, calls.get())
    }

    @Test
    fun `a failed refresh rethrows the original 401 without retrying`() = runTest {
        val calls = AtomicInteger()
        val retry = AuthRetry(tokenOf = { "t" }, refresh = { false })

        assertThrows(HttpException::class.java) {
            kotlinx.coroutines.runBlocking {
                retry.run<Unit> { calls.incrementAndGet(); throw httpError(401) }
            }
        }
        assertEquals(1, calls.get())
    }

    // Only 401 means "token expired". A 500 or a 403 must surface as-is - refreshing on those
    // would hide a server fault behind a login prompt.
    @Test
    fun `a non-401 http error is not refreshed`() = runTest {
        val refreshes = AtomicInteger()
        val retry = AuthRetry(tokenOf = { "t" }, refresh = { refreshes.incrementAndGet(); true })

        for (code in listOf(403, 500, 502)) {
            assertThrows(HttpException::class.java) {
                kotlinx.coroutines.runBlocking { retry.run<Unit> { throw httpError(code) } }
            }
        }
        assertEquals(0, refreshes.get())
    }

    @Test
    fun `a non-http failure propagates untouched`() = runTest {
        val refreshes = AtomicInteger()
        val retry = AuthRetry(tokenOf = { "t" }, refresh = { refreshes.incrementAndGet(); true })

        assertThrows(IllegalStateException::class.java) {
            kotlinx.coroutines.runBlocking { retry.run<Unit> { error("network down") } }
        }
        assertEquals(0, refreshes.get())
    }

    // The race the mutex exists for: two calls 401 at the same moment. The server rotates the
    // refresh token, so a second exchange would fail - and that failure, not the first call's
    // success, is what the user would have seen.
    @Test
    fun `concurrent 401s trigger exactly one refresh`() = runTest {
        var token = "expired"
        val refreshes = AtomicInteger()
        val retry = AuthRetry(
            tokenOf = { token },
            refresh = {
                refreshes.incrementAndGet()
                delay(20)
                token = "fresh"
                true
            },
        )

        val results = listOf(1, 2, 3).map { n ->
            async {
                var attempted = false
                retry.run {
                    if (!attempted) {
                        attempted = true
                        throw httpError(401)
                    }
                    "call$n:$token"
                }
            }
        }.awaitAll()

        assertEquals(1, refreshes.get())
        assertTrue(results.all { it.endsWith(":fresh") })
    }
}
