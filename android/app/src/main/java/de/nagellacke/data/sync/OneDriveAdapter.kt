package de.nagellacke.data.sync

import de.nagellacke.data.repo.SyncConfig
import kotlinx.serialization.encodeToString
import de.nagellacke.domain.mergeData
import de.nagellacke.domain.model.AppData
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.UUID

class OneDriveAdapter(private val config: SyncConfig) : SyncAdapter {
    override val provider = SyncProvider.OneDrive

    private val json = Json { ignoreUnknownKeys = true }
    private val graph = "https://graph.microsoft.com/v1.0/me/drive"
    private val dataPath = "nagellacke/nagellacke-data.json"

    private val client = OkHttpClient.Builder()
        .addInterceptor { chain ->
            chain.proceed(
                chain.request().newBuilder()
                    .header("Authorization", "Bearer ${config.accessToken}")
                    .build()
            )
        }
        .build()

    private suspend fun getRemoteData(): AppData? {
        val res = client.newCall(
            Request.Builder().url("$graph/root:/$dataPath:/content").get().build()
        ).execute()
        val body = res.body?.string()
        res.close()
        return if (res.isSuccessful && body != null) runCatching { json.decodeFromString<AppData>(body) }.getOrNull() else null
    }

    private suspend fun putData(data: AppData) {
        val body = json.encodeToString(data).toRequestBody("application/json".toMediaType())
        client.newCall(
            Request.Builder().url("$graph/root:/$dataPath:/content").put(body).build()
        ).execute().close()
    }

    override suspend fun sync(local: AppData): SyncResult = runCatching {
        val remote = getRemoteData()
        val merged = if (remote != null) mergeData(local, remote) else local
        putData(merged)
        SyncResult(success = true, merged = merged)
    }.getOrElse { e -> SyncResult(success = false, merged = local, error = e.message) }

    override suspend fun uploadPhoto(data: ByteArray, mimeType: String): PhotoUploadResult {
        val filename = "${UUID.randomUUID()}.jpg"
        val path = "nagellacke/photos/$filename"
        client.newCall(
            Request.Builder().url("$graph/root:/$path:/content")
                .put(data.toRequestBody(mimeType.toMediaType())).build()
        ).execute().close()
        return PhotoUploadResult(filename, "$graph/root:/$path:/content")
    }

    override suspend fun deletePhoto(filename: String) {
        client.newCall(
            Request.Builder().url("$graph/root:/nagellacke/photos/$filename").delete().build()
        ).execute().close()
    }

    override fun photoUrl(filename: String) = "$graph/root:/nagellacke/photos/$filename:/content"
}
