package de.nagellacke.data.sync

import de.nagellacke.domain.model.AppData
import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

@Serializable data class LoginRequest(val username: String, val password: String)
@Serializable data class RefreshRequest(val refreshToken: String)
/** Second step of a 2FA login: `code` takes either a 6-digit TOTP code or a recovery code. */
@Serializable data class VerifyRequest(val challengeToken: String, val code: String)

// All fields are nullable/defaulted — as of server #174, an account with TOTP
// 2FA enabled gets { mfaRequired: true, challengeToken } instead of { token,
// refreshToken } from POST /api/auth/login. kotlinx.serialization throws
// MissingFieldException on a non-optional field that's absent from the JSON,
// so a non-nullable `token` here would hard-crash the login call (not just
// fail gracefully) the moment any user enables 2FA from the web while still
// running this app. There is no code-entry screen yet (see AuthRepository) —
// this only stops the crash and surfaces a clear error instead.
@Serializable data class LoginResponse(
    val token: String? = null,
    val refreshToken: String? = null,
    val mfaRequired: Boolean = false,
    val challengeToken: String? = null,
)
/**
 * GET /api/auth/me. `role` is absent on a server predating #173, and every field is
 * optional for the same reason LoginResponse's are: a missing non-optional field throws
 * rather than degrading. A null role means "unknown", which callers must treat as
 * "assume the old behaviour", not as "not an admin".
 */
@Serializable data class MeResponse(
    val username: String? = null,
    val email: String? = null,
    val smtpConfigured: Boolean = false,
    val totpEnabled: Boolean = false,
    val role: String? = null,
)

@Serializable data class SyncRequest(val data: AppData, val clientTime: Long)
@Serializable data class SyncResponse(val data: AppData)
@Serializable data class PhotoRequest(val data: String, val mimeType: String)
@Serializable data class PhotoResponse(val filename: String)

interface ServerApi {
    @GET("api/auth/me")
    suspend fun me(): MeResponse

    @POST("api/auth/login")
    suspend fun login(@Body body: LoginRequest): LoginResponse

    @POST("api/auth/register")
    suspend fun register(@Body body: LoginRequest): LoginResponse

    @POST("api/auth/login/verify")
    suspend fun loginVerify(@Body body: VerifyRequest): LoginResponse

    // Response shape matches LoginResponse's { token, refreshToken } pair (see server's
    // issueTokens()) — mfaRequired/challengeToken are simply absent and default to false/null.
    @POST("api/auth/refresh")
    suspend fun refresh(@Body body: RefreshRequest): LoginResponse

    @GET("api/sync")
    suspend fun getSync(): SyncResponse

    @POST("api/sync")
    suspend fun postSync(@Body body: SyncRequest): SyncResponse

    @POST("api/photos")
    suspend fun uploadPhoto(@Body body: PhotoRequest): PhotoResponse

    @DELETE("api/photos/{filename}")
    suspend fun deletePhoto(@Path("filename") filename: String)
}
