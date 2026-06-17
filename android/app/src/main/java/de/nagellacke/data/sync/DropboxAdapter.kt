package de.nagellacke.data.sync

import de.nagellacke.data.repo.SyncConfig
import kotlinx.serialization.encodeToString
import de.nagellacke.domain.mergeData
import de.nagellacke.domain.model.AppData
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.UUID

class DropboxAdapter(private val config: SyncConfig) : SyncAdapter {
    override val provider = SyncProvider.Dropbox

    private val json = Json { ignoreUnknownKeys = true }
    private val content = "https://content.dropboxapi.com/2"
    private val api = "https://api.dropboxapi.com/2"
    private val dataPath = "/nagellacke/nagellacke-data.json"

    private val client = OkHttpClient.Builder()
        .addInterceptor { chain ->
            chain.proceed(
                chain.request().newBuilder()
                    .header("Authorization", "Bearer ${config.accessToken}")
                    .build()
            )
        }
        .build()

    private suspend fun downloadData(): AppData? {
        val arg = """{"path":"$dataPath"}"""
        val res = client.newCall(
            Request.Builder().url("$content/files/download")
                .post("".toRequestBody())
                .header("Dropbox-API-Arg", arg)
                .build()
        ).execute()
        val body = res.body?.string()
        res.close()
        return if (res.isSuccessful && body != null) runCatching { json.decodeFromString<AppData>(body) }.getOrNull() else null
    }

    private suspend fun uploadData(data: AppData) {
        val arg = """{"path":"$dataPath","mode":"overwrite","autorename":false}"""
        val body = json.encodeToString(data)
        client.newCall(
            Request.Builder().url("$content/files/upload")
                .post(body.toRequestBody("application/octet-stream".toMediaType()))
                .header("Dropbox-API-Arg", arg)
                .build()
        ).execute().close()
    }

    override suspend fun sync(local: AppData): SyncResult = runCatching {
        val remote = downloadData()
        val merged = if (remote != null) mergeData(local, remote) else local
        uploadData(merged)
        SyncResult(success = true, merged = merged)
    }.getOrElse { e -> SyncResult(success = false, merged = local, error = e.message) }

    override suspend fun uploadPhoto(data: ByteArray, mimeType: String): PhotoUploadResult {
        val filename = "${UUID.randomUUID()}.jpg"
        val path = "/nagellacke/photos/$filename"
        val arg = """{"path":"$path","mode":"add"}"""
        client.newCall(
            Request.Builder().url("$content/files/upload")
                .post(data.toRequestBody("application/octet-stream".toMediaType()))
                .header("Dropbox-API-Arg", arg)
                .build()
        ).execute().close()
        return PhotoUploadResult(filename, path)
    }

    override suspend fun deletePhoto(filename: String) {
        client.newCall(
            Request.Builder().url("$api/files/delete_v2")
                .post("""{"path":"/nagellacke/photos/$filename"}""".toRequestBody("application/json".toMediaType()))
                .build()
        ).execute().close()
    }

    override fun photoUrl(filename: String) = "$content/files/download?path=/nagellacke/photos/$filename"
}
