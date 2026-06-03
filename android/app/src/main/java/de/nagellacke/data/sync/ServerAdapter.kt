package de.nagellacke.data.sync

import android.util.Base64
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
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
            .addInterceptor(HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC })
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

    suspend fun login(username: String, password: String): String =
        api.login(LoginRequest(username, password)).token

    suspend fun register(username: String, password: String): String =
        api.register(LoginRequest(username, password)).token
}
