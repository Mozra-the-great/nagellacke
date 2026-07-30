package de.nagellacke.data.sync

import android.util.Base64
import de.nagellacke.BuildConfig
import de.nagellacke.data.repo.SyncConfig
import de.nagellacke.domain.mergeData
import de.nagellacke.domain.model.AppData
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.logging.HttpLoggingInterceptor
import java.util.UUID

class NextcloudAdapter(private val config: SyncConfig) : SyncAdapter {
    override val provider = SyncProvider.Nextcloud

    private val json = Json { ignoreUnknownKeys = true }
    private val authHeader = "Basic " + Base64.encodeToString(
        "${config.nextcloudUser}:${config.nextcloudPassword}".toByteArray(),
        Base64.NO_WRAP,
    )

    private val client = OkHttpClient.Builder()
        .apply {
            if (BuildConfig.DEBUG) {
                addInterceptor(HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC })
            }
        }
        .build()

    private val base = config.nextcloudUrl.trimEnd('/')
    private val davBase = "$base/remote.php/dav/files/${config.nextcloudUser}"
    private val dataUrl = "$davBase/nagellacke/nagellacke-data.json"

    private suspend fun ensureDir(path: String) {
        val url = "$davBase/$path"
        val check = client.newCall(
            Request.Builder().url(url).method("PROPFIND", null)
                .header("Authorization", authHeader).build()
        ).execute()
        check.close()
        if (!check.isSuccessful) {
            client.newCall(
                Request.Builder().url(url).method("MKCOL", null)
                    .header("Authorization", authHeader).build()
            ).execute().close()
        }
    }

    private fun fetchRemote(): RemoteFetchResult {
        val getRes = client.newCall(
            Request.Builder().url(dataUrl).get().header("Authorization", authHeader).build()
        ).execute()
        return getRes.use { res ->
            when {
                res.code == 404 -> RemoteFetchResult.NotFound
                res.isSuccessful -> {
                    val bodyStr = res.body?.string()
                    val parsed = bodyStr?.let { runCatching { json.decodeFromString<AppData>(it) }.getOrNull() }
                    if (parsed != null) RemoteFetchResult.Found(parsed)
                    else RemoteFetchResult.Error("Antwort konnte nicht gelesen werden")
                }
                else -> RemoteFetchResult.Error("Lesefehler (HTTP ${res.code})")
            }
        }
    }

    override suspend fun sync(local: AppData): SyncResult = try {
        ensureDir("nagellacke")
        when (val fetch = fetchRemote()) {
            is RemoteFetchResult.Error -> SyncResult(success = false, merged = local, error = fetch.message)
            else -> {
                val remote = (fetch as? RemoteFetchResult.Found)?.data
                val merged = if (remote != null) mergeData(local, remote) else local
                val body = json.encodeToString(merged).toRequestBody("application/json".toMediaType())
                val putRes = client.newCall(
                    Request.Builder().url(dataUrl).put(body).header("Authorization", authHeader).build()
                ).execute()
                val ok = putRes.isSuccessful
                val code = putRes.code
                putRes.close()
                if (!ok) SyncResult(success = false, merged = local, error = "Schreibfehler (HTTP $code)")
                else SyncResult(success = true, merged = merged)
            }
        }
    } catch (e: Exception) {
        SyncResult(success = false, merged = local, error = e.message)
    }

    override suspend fun uploadPhoto(data: ByteArray, mimeType: String): PhotoUploadResult {
        ensureDir("nagellacke/photos")
        val filename = "${UUID.randomUUID()}.jpg"
        val url = "$davBase/nagellacke/photos/$filename"
        client.newCall(
            Request.Builder().url(url).put(data.toRequestBody(mimeType.toMediaType()))
                .header("Authorization", authHeader).build()
        ).execute().close()
        return PhotoUploadResult(filename, url)
    }

    override suspend fun deletePhoto(filename: String) {
        client.newCall(
            Request.Builder().url("$davBase/nagellacke/photos/$filename")
                .delete().header("Authorization", authHeader).build()
        ).execute().close()
    }

    override fun photoUrl(filename: String) = "$davBase/nagellacke/photos/$filename"
}
