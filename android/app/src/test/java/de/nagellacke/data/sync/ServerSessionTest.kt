package de.nagellacke.data.sync

import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.util.Collections
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread

/**
 * #349: ReportsClient and AiClient sent a token fixed at construction time and never refreshed
 * it, so an expired access token failed every report/AI call until a sync happened to renew it.
 * Runs the real clients against a local HTTP server that only accepts the refreshed token.
 */
class ServerSessionTest {
    private lateinit var server: TinyHttpServer
    private val seenAuth: MutableList<String> = Collections.synchronizedList(mutableListOf())
    private val refreshCallCount = AtomicInteger()
    private val refreshCalls get() = refreshCallCount.get()

    @Before fun start() {
        server = TinyHttpServer { path, headers, body ->
            if (path == "/api/auth/refresh") {
                refreshCallCount.incrementAndGet()
                if ("\"old-refresh\"" in body) 200 to """{"token":"fresh-access","refreshToken":"new-refresh"}"""
                else 401 to """{"error":"nope"}"""
            } else {
                val auth = headers["authorization"] ?: ""
                seenAuth += auth
                if (auth == "Bearer fresh-access") 200 to """{"config":null,"smtpConfigured":true,"ok":true,"jobId":"j1"}"""
                else 401 to """{"error":"Unauthorized"}"""
            }
        }
    }

    @After fun stop() = server.close()

    private val url get() = "http://127.0.0.1:${server.port}"

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

/**
 * Just enough HTTP/1.1 for these tests: one request per connection, `Connection: close`.
 * Built on java.net only because Android unit tests compile against android.jar, which has
 * no com.sun.net.httpserver, and the project carries no MockWebServer dependency.
 */
private class TinyHttpServer(
    private val handle: (path: String, headers: Map<String, String>, body: String) -> Pair<Int, String>,
) : AutoCloseable {
    private val socket = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
    val port: Int get() = socket.localPort

    init {
        thread(isDaemon = true) {
            while (!socket.isClosed) {
                val client = try { socket.accept() } catch (e: IOException) { break }
                client.use { c ->
                    val input = c.getInputStream().bufferedReader(Charsets.UTF_8)
                    val requestLine = input.readLine() ?: return@use
                    val path = requestLine.split(" ").getOrElse(1) { "/" }
                    val headers = mutableMapOf<String, String>()
                    while (true) {
                        val line = input.readLine() ?: break
                        if (line.isEmpty()) break
                        val i = line.indexOf(':')
                        if (i > 0) headers[line.substring(0, i).trim().lowercase()] = line.substring(i + 1).trim()
                    }
                    // Bodies here are ASCII JSON, so chars == bytes.
                    val length = headers["content-length"]?.toIntOrNull() ?: 0
                    val buf = CharArray(length)
                    var read = 0
                    while (read < length) {
                        val n = input.read(buf, read, length - read)
                        if (n < 0) break
                        read += n
                    }
                    val (status, body) = handle(path, headers, String(buf, 0, read))
                    val bytes = body.encodeToByteArray()
                    val out = c.getOutputStream()
                    out.write(
                        ("HTTP/1.1 $status Status\r\nContent-Type: application/json\r\n" +
                            "Content-Length: ${bytes.size}\r\nConnection: close\r\n\r\n").encodeToByteArray(),
                    )
                    out.write(bytes)
                    out.flush()
                }
            }
        }
    }

    override fun close() = socket.close()
}
