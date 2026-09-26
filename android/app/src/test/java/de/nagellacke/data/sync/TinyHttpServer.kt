package de.nagellacke.data.sync

import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import kotlin.concurrent.thread

/**
 * Just enough HTTP/1.1 for these tests: one request per connection, `Connection: close`.
 * Built on java.net only because Android unit tests compile against android.jar, which has
 * no com.sun.net.httpserver, and the project carries no MockWebServer dependency.
 */
internal class TinyHttpServer(
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
