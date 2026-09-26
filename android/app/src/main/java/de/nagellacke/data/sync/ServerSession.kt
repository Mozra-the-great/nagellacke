package de.nagellacke.data.sync

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import de.nagellacke.data.repo.SyncConfig
import de.nagellacke.data.repo.SyncConfigStore
import kotlinx.serialization.json.Json
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit

/**
 * The access/refresh token pair for the configured server, for the clients that sit outside
 * ServerAdapter: [ReportsClient] and [AiClient] (#349). They used to bake `serverToken` into a
 * static header, so once the access token expired every report and AI call failed with a bare
 * 401 until the next sync happened to renew it, while sync and photo calls refreshed silently.
 *
 * Same policy as ServerAdapter: [authInterceptor] always sends the current token, and
 * [withAuthRetry] refreshes once and retries once on a 401 ([AuthRetry]). A renewed pair is
 * written back to [configStore], so the next client built from the config starts with it.
 */
class ServerSession(
    serverUrl: String,
    accessToken: String,
    refreshToken: String,
    private val configStore: SyncConfigStore?,
) {
    @Volatile private var accessToken = accessToken
    @Volatile private var refreshToken = refreshToken

    private val baseUrl = serverUrl.trimEnd('/') + "/"
    private val authRetry = AuthRetry(tokenOf = { this.accessToken }, refresh = ::exchangeRefreshToken)

    /** Adds `Authorization` with whatever token is current at the time the request is sent. */
    val authInterceptor = Interceptor { chain ->
        chain.proceed(chain.request().newBuilder().header("Authorization", "Bearer ${this.accessToken}").build())
    }

    /** Plain client for the refresh call itself: it must not carry the expired access token. */
    private val refreshApi: ServerApi by lazy {
        Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(OkHttpClient())
            .addConverterFactory(Json { ignoreUnknownKeys = true }.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(ServerApi::class.java)
    }

    suspend fun <T> withAuthRetry(block: suspend () -> T): T = authRetry.run(block)

    private suspend fun exchangeRefreshToken(): Boolean {
        val current = refreshToken
        if (current.isBlank()) return false
        return try {
            val response = refreshApi.refresh(RefreshRequest(current))
            val newAccess = response.token ?: return false
            accessToken = newAccess
            refreshToken = response.refreshToken ?: current
            configStore?.saveServerTokens(newAccess, refreshToken)
            true
        } catch (e: Exception) {
            false
        }
    }

    companion object {
        fun from(config: SyncConfig, configStore: SyncConfigStore?): ServerSession =
            ServerSession(config.serverUrl, config.serverToken, config.serverRefreshToken, configStore)
    }
}
