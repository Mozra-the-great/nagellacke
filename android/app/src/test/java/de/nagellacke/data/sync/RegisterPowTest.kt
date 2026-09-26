package de.nagellacke.data.sync

import de.nagellacke.domain.Pow
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import retrofit2.HttpException
import java.security.MessageDigest
import java.util.Collections

/**
 * #324 S13: a server can require a proof of work on registration. The app registers
 * accounts too, so it has to solve the challenge — otherwise switching the check on would
 * lock Android out of registering. Runs the real AuthRepository against a local server
 * that checks the solution the way the real one does.
 */
class RegisterPowTest {
    private var server: TinyHttpServer? = null
    private val registerBodies: MutableList<String> = Collections.synchronizedList(mutableListOf())
    private val challengeCalls: MutableList<String> = Collections.synchronizedList(mutableListOf())

    @After fun stop() { server?.close() }

    private fun start(statusCode: Int, requiresPow: Boolean, enforcePow: Boolean): String {
        val s = TinyHttpServer { path, _, body ->
            when (path) {
                "/api/auth/registration-status" ->
                    statusCode to """{"allowed":true,"firstUser":false,"requiresPow":$requiresPow}"""
                "/api/auth/pow-challenge" -> {
                    challengeCalls += path
                    200 to """{"salt":"$SALT","difficulty":8,"expires":9999999999999,"sig":"signed"}"""
                }
                "/api/auth/register" -> {
                    registerBodies += body
                    if (!enforcePow || solves(body)) 200 to """{"token":"access","refreshToken":"refresh"}"""
                    else 400 to """{"error":"Sicherheitsprüfung fehlgeschlagen","powRequired":true}"""
                }
                else -> 404 to """{"error":"not found"}"""
            }
        }
        server = s
        return "http://127.0.0.1:${s.port}"
    }

    private fun solves(body: String): Boolean {
        val pow = Json.parseToJsonElement(body).jsonObject["pow"]?.jsonObject ?: return false
        if (pow["salt"]?.jsonPrimitive?.content != SALT || pow["sig"]?.jsonPrimitive?.content != "signed") return false
        val n = pow["n"]?.jsonPrimitive?.long ?: return false
        val hash = MessageDigest.getInstance("SHA-256").digest("$SALT$n".toByteArray())
        return Pow.hasLeadingZeroBits(hash, 8)
    }

    @Test fun `solves up front when the server says so`() = runTest {
        val url = start(200, requiresPow = true, enforcePow = true)
        val auth = AuthRepository(url).register("anna", "correct-horse")
        assertEquals("access", auth.token)
        assertEquals(1, registerBodies.size)
    }

    @Test fun `retries once with a solution when the server asks after all`() = runTest {
        // Status read before the admin switched the check on.
        val url = start(200, requiresPow = false, enforcePow = true)
        val auth = AuthRepository(url).register("anna", "correct-horse")
        assertEquals("access", auth.token)
        assertEquals(2, registerBodies.size)
        assertTrue("first attempt carries no pow", !registerBodies[0].contains("\"pow\""))
    }

    @Test fun `an older server gets the plain request and no challenge call`() = runTest {
        val url = start(404, requiresPow = false, enforcePow = false)
        AuthRepository(url).register("anna", "correct-horse")
        assertEquals(1, registerBodies.size)
        assertTrue(!registerBodies[0].contains("\"pow\""))
        assertTrue(challengeCalls.isEmpty())
    }

    @Test fun `any other 400 is not retried`() = runTest {
        val s = TinyHttpServer { path, _, body ->
            if (path == "/api/auth/register") { registerBodies += body; 400 to """{"error":"Benutzername ungültig"}""" }
            else 404 to "{}"
        }
        server = s
        try {
            AuthRepository("http://127.0.0.1:${s.port}").register("x", "correct-horse")
            fail("expected HttpException")
        } catch (e: HttpException) {
            assertEquals(400, e.code())
        }
        assertEquals(1, registerBodies.size)
    }

    private companion object {
        const val SALT = "fedcba9876543210fedcba9876543210"
    }
}
