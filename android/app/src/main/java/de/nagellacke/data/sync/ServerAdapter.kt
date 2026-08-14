package de.nagellacke.data.sync

import android.util.Base64
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import de.nagellacke.BuildConfig
import de.nagellacke.data.repo.SyncConfig
import de.nagellacke.data.repo.SyncConfigStore
import de.nagellacke.domain.mergeData
import de.nagellacke.domain.model.AppData
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.HttpException
import retrofit2.Retrofit

class ServerAdapter(
    private val config: SyncConfig,
    private val configStore: SyncConfigStore? = null,
) : SyncAdapter {
    override val provider = SyncProvider.Server

    private val json = Json { ignoreUnknownKeys = true }

    // Mutable so a successful refresh (see exchangeRefreshToken) takes effect on the very next
    // request from this adapter instance without rebuilding the Retrofit client.
    @Volatile private var accessToken = config.serverToken
    @Volatile private var refreshToken = config.serverRefreshToken

    private val authRetry = AuthRetry(tokenOf = { accessToken }, refresh = ::exchangeRefreshToken)

    private val api: ServerApi by lazy {
        val base = config.serverUrl.trimEnd('/') + "/"
        val client = OkHttpClient.Builder()
            .addInterceptor { chain ->
                chain.proceed(
                    chain.request().newBuilder()
                        .header("Authorization", "Bearer $accessToken")
                        .build()
                )
            }
            .apply {
                if (BuildConfig.DEBUG) {
                    addInterceptor(HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC })
                }
            }
            .build()

        Retrofit.Builder()
            .baseUrl(base)
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(ServerApi::class.java)
    }

    /**
     * Trades [refreshToken] for a fresh access token via POST /api/auth/refresh. Returns false if
     * there is no refresh token to use or the exchange fails, so the caller can surface a re-auth
     * prompt instead of retrying forever. Concurrency is handled by [AuthRetry].
     */
    private suspend fun exchangeRefreshToken(): Boolean {
        val currentRefreshToken = refreshToken
        if (currentRefreshToken.isBlank()) return false
        return try {
            val response = api.refresh(RefreshRequest(currentRefreshToken))
            val newAccessToken = response.token ?: return false
            accessToken = newAccessToken
            refreshToken = response.refreshToken ?: currentRefreshToken
            configStore?.saveServerTokens(newAccessToken, refreshToken)
            true
        } catch (e: Exception) {
            false
        }
    }

    private suspend fun <T> withAuthRetry(block: suspend () -> T): T = authRetry.run(block)

    override suspend fun sync(local: AppData): SyncResult = runCatching {
        // POST /api/sync merges + persists on the server and returns the merged data
        val response = withAuthRetry { api.postSync(SyncRequest(data = local, clientTime = System.currentTimeMillis())) }
        val merged = mergeData(local, response.data)
        SyncResult(success = true, merged = merged)
    }.getOrElse { e ->
        val message = if (e is HttpException && e.code() == 401) {
            "Sitzung abgelaufen — bitte in den Einstellungen erneut anmelden."
        } else {
            e.message ?: "Unbekannter Fehler"
        }
        SyncResult(success = false, merged = local, error = message)
    }

    override suspend fun uploadPhoto(data: ByteArray, mimeType: String): PhotoUploadResult {
        val base64 = Base64.encodeToString(data, Base64.NO_WRAP)
        val response = withAuthRetry { api.uploadPhoto(PhotoRequest(data = base64, mimeType = mimeType)) }
        return PhotoUploadResult(filename = response.filename, url = photoUrl(response.filename))
    }

    override suspend fun deletePhoto(filename: String) {
        withAuthRetry { api.deletePhoto(filename) }
    }

    override fun photoUrl(filename: String): String =
        "${config.serverUrl.trimEnd('/')}/photos/${filename}"

    /**
     * The signed-in account's role, or null when it cannot be determined — an offline
     * device, or a server predating #173 that has no role concept at all. Callers must
     * treat null as "unknown", never as "not an admin": gating a screen off on a failed
     * request would hide settings from the very admin who needs them (#243).
     */
    suspend fun fetchRole(): String? = runCatching { withAuthRetry { api.me() }.role }.getOrNull()
}

/** Access/refresh token pair returned by a successful login or registration. */
data class AuthResult(val token: String, val refreshToken: String)

/**
 * Outcome of a login attempt. An account with 2FA enabled does not get tokens from
 * POST /api/auth/login — it gets a short-lived challenge that only
 * POST /api/auth/login/verify accepts, so the caller has to ask for the code and finish
 * the exchange rather than treating the response as a failure (#227).
 */
sealed interface LoginOutcome {
    data class Success(val auth: AuthResult) : LoginOutcome
    data class MfaRequired(val challengeToken: String) : LoginOutcome
}

class AuthRepository(private val baseUrl: String) {
    private val json = Json { ignoreUnknownKeys = true }

    private val api: ServerApi by lazy {
        val base = baseUrl.trimEnd('/') + "/"
        Retrofit.Builder()
            .baseUrl(base)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(ServerApi::class.java)
    }

    suspend fun login(username: String, password: String): LoginOutcome {
        val response = api.login(LoginRequest(username, password))
        if (response.mfaRequired) {
            val challenge = response.challengeToken
                ?: throw IllegalStateException("Server verlangt 2FA, hat aber keinen Challenge-Token geschickt.")
            return LoginOutcome.MfaRequired(challenge)
        }
        val token = response.token
            ?: throw IllegalStateException("Anmeldung fehlgeschlagen: kein Token erhalten.")
        return LoginOutcome.Success(AuthResult(token, response.refreshToken ?: ""))
    }

    /**
     * Second step of a 2FA login. [code] is either the 6-digit code from the authenticator
     * or one of the recovery codes — the server accepts both through the same field.
     */
    suspend fun verifyMfa(challengeToken: String, code: String): AuthResult {
        val response = api.loginVerify(VerifyRequest(challengeToken, code.trim()))
        val token = response.token
            ?: throw IllegalStateException("Bestätigung fehlgeschlagen: kein Token erhalten.")
        return AuthResult(token, response.refreshToken ?: "")
    }

    suspend fun register(username: String, password: String): AuthResult {
        val response = api.register(LoginRequest(username, password))
        val token = response.token
            ?: throw IllegalStateException("Registrierung fehlgeschlagen: kein Token erhalten.")
        return AuthResult(token, response.refreshToken ?: "")
    }
}
