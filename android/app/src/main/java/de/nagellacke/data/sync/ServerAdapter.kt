package de.nagellacke.data.sync

import android.util.Base64
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import de.nagellacke.BuildConfig
import de.nagellacke.data.repo.SyncConfig
import de.nagellacke.domain.mergeData
import de.nagellacke.domain.model.AppData
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit

class ServerAdapter(private val config: SyncConfig) : SyncAdapter {
    override val provider = SyncProvider.Server

    private val json = Json { ignoreUnknownKeys = true }

    private val api: ServerApi by lazy {
        val base = config.serverUrl.trimEnd('/') + "/"
        val client = OkHttpClient.Builder()
            .addInterceptor { chain ->
                chain.proceed(
                    chain.request().newBuilder()
                        .header("Authorization", "Bearer ${config.serverToken}")
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

    override suspend fun sync(local: AppData): SyncResult = runCatching {
        // POST /api/sync merges + persists on the server and returns the merged data
        val response = api.postSync(SyncRequest(data = local, clientTime = System.currentTimeMillis()))
        val merged = mergeData(local, response.data)
        SyncResult(success = true, merged = merged)
    }.getOrElse { e ->
        SyncResult(success = false, merged = local, error = e.message ?: "Unbekannter Fehler")
    }

    override suspend fun uploadPhoto(data: ByteArray, mimeType: String): PhotoUploadResult {
        val base64 = Base64.encodeToString(data, Base64.NO_WRAP)
        val response = api.uploadPhoto(PhotoRequest(data = base64, mimeType = mimeType))
        return PhotoUploadResult(filename = response.filename, url = photoUrl(response.filename))
    }

    override suspend fun deletePhoto(filename: String) {
        api.deletePhoto(filename)
    }

    override fun photoUrl(filename: String): String =
        "${config.serverUrl.trimEnd('/')}/photos/${filename}"
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

    // Two-factor accounts (server #174) return { mfaRequired: true,
    // challengeToken } instead of a token here. There is no code-entry screen
    // in this app yet, so surface a clear, actionable error instead of a null
    // token reaching the caller — the alternative before the LoginResponse
    // nullability fix was a hard crash on this exact response.
    suspend fun login(username: String, password: String): String {
        val response = api.login(LoginRequest(username, password))
        if (response.mfaRequired || response.token == null) {
            throw IllegalStateException(
                "Dieses Konto hat Zwei-Faktor-Authentifizierung (2FA) aktiviert. " +
                    "Die Android-App unterstützt 2FA-Login noch nicht — bitte über die Web-Oberfläche anmelden."
            )
        }
        return response.token
    }

    suspend fun register(username: String, password: String): String {
        val response = api.register(LoginRequest(username, password))
        return response.token
            ?: throw IllegalStateException("Registrierung fehlgeschlagen: kein Token erhalten.")
    }
}
