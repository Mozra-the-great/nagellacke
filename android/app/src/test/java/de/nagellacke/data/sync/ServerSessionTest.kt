package de.nagellacke.data.sync

import com.sun.net.httpserver.HttpServer
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.net.InetSocketAddress
import java.util.Collections

/**
 * #349: ReportsClient and AiClient sent a token fixed at construction time and never refreshed
 * it, so an expired access token failed every report/AI call until a sync happened to renew it.
 * Runs the real clients against a local HTTP server that only accepts the refreshed token.
 */
class ServerSessionTest {
    private lateinit var server: HttpServer
    private val seenAuth: MutableList<String> = Collections.synchronizedList(mutableListOf())
    private val refreshCallCount = java.util.concurrent.atomic.AtomicInteger()
    private val refreshCalls get() = refreshCallCount.get()

    @Before fun start() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { ex ->
            val auth = ex.requestHeaders.getFirst("Authorization") ?: ""
            val (status, body) = when (ex.requestURI.path) {
                "/api/auth/refresh" -> {
                    refreshCallCount.incrementAndGet()
                    val sent = ex.requestBody.readBytes().decodeToString()
                    if ("\"old-refresh\"" in sent) 200 to """{"token":"fresh-access","refreshToken":"new-refresh"}"""
                    else 401 to """{"error":"nope"}"""
                }
                else -> {
                    seenAuth += auth
                    if (auth == "Bearer fresh-access") 200 to """{"config":null,"smtpConfigured":true,"ok":true,"jobId":"j1"}"""
                    else 401 to """{"error":"Unauthorized"}"""
                }
            }
            val bytes = body.encodeToByteArray()
            ex.responseHeaders.add("Content-Type", "application/json")
            ex.sendResponseHeaders(status, bytes.size.toLong())
            ex.responseBody.use { it.write(bytes) }
        }
        server.start()
    }

    @After fun stop() = server.stop(0)

    private val url get() = "http://127.0.0.1:${server.address.port}"

    private fun session(refresh: String = "old-refresh") = ServerSession(url, "expired-access", refresh, configStore = null)

    @Test fun `report calls refresh an expired token and retry once`() = runTest {
        val result = ReportsClient(session(), url).getSchedule()

        assertTrue(result.isSuccess)
        assertEquals(true, result.getOrThrow().smtpConfigured)
        assertEquals(listOf("Bearer expired-access", "Bearer fresh-access"), seenAuth)
        assertEquals(1, refreshCalls)
    }

    @Test fun `ai calls refresh an expired token too`() = runTest {
        val result = AiClient(session(), url).startSmartCart("rot")

        assertEquals("j1", result.getOrThrow())
        assertEquals(1, refreshCalls)
    }

    @Test fun `a refreshed token is reused by the next call without another refresh`() = runTest {
        val client = ReportsClient(session(), url)
        client.getSchedule().getOrThrow()
        client.getSchedule().getOrThrow()

        assertEquals(1, refreshCalls)
        assertEquals("Bearer fresh-access", seenAuth.last())
    }

    @Test fun `a failed refresh surfaces the original 401 instead of looping`() = runTest {
        val result = ReportsClient(session(refresh = "revoked"), url).getSchedule()

        assertTrue(result.isFailure)
        assertEquals(1, refreshCalls)
        assertEquals(1, seenAuth.size)
    }
}
