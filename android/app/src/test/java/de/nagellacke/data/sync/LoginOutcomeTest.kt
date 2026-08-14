package de.nagellacke.data.sync

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The 2FA login hinges on telling three server responses apart from the same endpoint
 * (#227). Retrofit hands the JSON to kotlinx.serialization, so decoding is what decides
 * which branch the dialog takes — that is what these cover.
 */
class LoginOutcomeTest {

    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `a plain login response decodes to tokens`() {
        val res = json.decodeFromString<LoginResponse>(
            """{"token":"access-abc","refreshToken":"refresh-xyz"}""",
        )
        assertEquals("access-abc", res.token)
        assertEquals("refresh-xyz", res.refreshToken)
        assertEquals(false, res.mfaRequired)
        assertNull(res.challengeToken)
    }

    // The shape that used to hard-crash the login call before the fields were made
    // nullable: no `token` at all, which a non-optional field would reject outright.
    @Test
    fun `a 2FA challenge decodes without a token`() {
        val res = json.decodeFromString<LoginResponse>(
            """{"mfaRequired":true,"challengeToken":"challenge-123"}""",
        )
        assertEquals(true, res.mfaRequired)
        assertEquals("challenge-123", res.challengeToken)
        assertNull(res.token)
    }

    @Test
    fun `the verify response decodes like a plain login`() {
        val res = json.decodeFromString<LoginResponse>(
            """{"token":"access-after-2fa","refreshToken":"refresh-after-2fa"}""",
        )
        assertEquals("access-after-2fa", res.token)
        assertEquals("refresh-after-2fa", res.refreshToken)
    }

    // A server that gains fields this app has not been taught yet must not break login.
    @Test
    fun `unknown fields are ignored`() {
        val res = json.decodeFromString<LoginResponse>(
            """{"token":"t","refreshToken":"r","somethingNew":{"nested":true}}""",
        )
        assertEquals("t", res.token)
    }

    @Test
    fun `an empty object decodes to all-absent rather than throwing`() {
        val res = json.decodeFromString<LoginResponse>("{}")
        assertNull(res.token)
        assertNull(res.challengeToken)
        assertEquals(false, res.mfaRequired)
    }

    @Test
    fun `the verify request serializes the fields the server expects`() {
        val encoded = json.encodeToString(VerifyRequest.serializer(), VerifyRequest("challenge-123", "654321"))
        assertTrue(encoded.contains(""""challengeToken":"challenge-123""""))
        assertTrue(encoded.contains(""""code":"654321""""))
    }

    // The server takes a recovery code through the same field as a TOTP code, so nothing
    // in the client may assume six digits.
    @Test
    fun `a recovery code goes through the same field`() {
        val encoded = json.encodeToString(VerifyRequest.serializer(), VerifyRequest("challenge-123", "a1b2-c3d4"))
        assertTrue(encoded.contains(""""code":"a1b2-c3d4""""))
    }

    @Test
    fun `LoginOutcome distinguishes success from a pending second factor`() {
        val success: LoginOutcome = LoginOutcome.Success(AuthResult("t", "r"))
        val pending: LoginOutcome = LoginOutcome.MfaRequired("challenge-123")

        assertTrue(success is LoginOutcome.Success)
        assertTrue(pending is LoginOutcome.MfaRequired)
        assertEquals("challenge-123", (pending as LoginOutcome.MfaRequired).challengeToken)
        assertEquals("t", (success as LoginOutcome.Success).auth.token)
    }
}
