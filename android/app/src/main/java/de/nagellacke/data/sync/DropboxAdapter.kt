package de.nagellacke.data.sync

import de.nagellacke.data.repo.SyncConfig
import de.nagellacke.data.repo.SyncConfigStore
import de.nagellacke.ui.settings.OAuthClientIds
import kotlinx.serialization.encodeToString
import de.nagellacke.domain.mergeData
import de.nagellacke.domain.model.AppData
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.UUID

class DropboxAdapter(
    private val config: SyncConfig,
    private val configStore: SyncConfigStore? = null,
) : SyncAdapter {
    override val provider = SyncProvider.Dropbox

    private val json = Json { ignoreUnknownKeys = true }
    private val content = "https://content.dropboxapi.com/2"
    private val api = "https://api.dropboxapi.com/2"
    private val dataPath = "/nagellacke/nagellacke-data.json"
    private val tokenEndpoint = "https://api.dropboxapi.com/oauth2/token"

    @Volatile private var accessToken = config.accessToken

    private val client = OkHttpClient.Builder()
        .addInterceptor { chain ->
            chain.proceed(
                chain.request().newBuilder()
                    .header("Authorization", "Bearer $accessToken")
                    .build()
            )
        }
        .build()

    /** Unauthenticated client used for the token-refresh POST itself. */
    private val plainClient = OkHttpClient.Builder().build()

    /** Refreshes [accessToken] if it's expired (60s skew margin). Returns false if it can't be made valid. */
    private fun ensureFreshAccessToken(): Boolean {
        val now = System.currentTimeMillis()
        val skewMs = 60_000L
        if (accessToken.isNotBlank() && now < config.tokenExpiry - skewMs) return true
        val refreshToken = config.refreshToken
        if (refreshToken.isBlank()) return false
        val refreshed = refreshOAuthToken(plainClient, json, tokenEndpoint, OAuthClientIds.Dropbox, refreshToken) ?: return false
        accessToken = refreshed.accessToken
        configStore?.saveTokens(provider, refreshed.accessToken, refreshed.refreshToken ?: refreshToken, now + refreshed.expiresIn * 1000)
        return true
    }

    private fun fetchRemote(): RemoteFetchResult {
        val arg = """{"path":"$dataPath"}"""
        val res = client.newCall(
            Request.Builder().url("$content/files/download")
                .post("".toRequestBody())
                .header("Dropbox-API-Arg", arg)
                .build()
        ).execute()
        return res.use { r ->
            when {
                // Dropbox reports a missing file as HTTP 409 with a path/not_found error body.
                r.code == 409 -> RemoteFetchResult.NotFound
                r.isSuccessful -> {
                    val body = r.body?.string()
                    val parsed = body?.let { runCatching { json.decodeFromString<AppData>(it) }.getOrNull() }
                    if (parsed != null) RemoteFetchResult.Found(parsed)
                    else RemoteFetchResult.Error("Antwort konnte nicht gelesen werden")
                }
                else -> RemoteFetchResult.Error("Lesefehler (HTTP ${r.code})")
            }
        }
    }

    // Every network call in this adapter is OkHttp's *synchronous* execute(), and
    // syncNow() launches on viewModelScope (Dispatchers.Main) - so without this hop
    // the call ran on the main thread and Android threw NetworkOnMainThreadException
    // unconditionally, crashing "Sync jetzt" (#270). The blocking bodies stay plain
    // (non-suspend) functions so their early `return`s remain legal: withContext is
    // not inline, so a non-local return out of its lambda would not compile.
    override suspend fun sync(local: AppData): SyncResult =
        withContext(Dispatchers.IO) { syncBlocking(local) }

    override suspend fun uploadPhoto(data: ByteArray, mimeType: String): PhotoUploadResult =
        withContext(Dispatchers.IO) { uploadPhotoBlocking(data, mimeType) }

    override suspend fun deletePhoto(filename: String): Unit =
        withContext(Dispatchers.IO) { deletePhotoBlocking(filename) }

    private fun syncBlocking(local: AppData): SyncResult {
        if (!ensureFreshAccessToken()) {
            return SyncResult(success = false, merged = local, error = "OAuth-Token abgelaufen und konnte nicht erneuert werden. Bitte erneut anmelden.")
        }
        return try {
            when (val fetch = fetchRemote()) {
                is RemoteFetchResult.Error -> SyncResult(success = false, merged = local, error = fetch.message)
                else -> {
                    val remote = (fetch as? RemoteFetchResult.Found)?.data
                    val merged = if (remote != null) mergeData(local, remote) else local
                    val arg = """{"path":"$dataPath","mode":"overwrite","autorename":false}"""
                    val body = json.encodeToString(merged)
                    val putRes = client.newCall(
                        Request.Builder().url("$content/files/upload")
                            .post(body.toRequestBody("application/octet-stream".toMediaType()))
                            .header("Dropbox-API-Arg", arg)
                            .build()
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
    }

    private fun uploadPhotoBlocking(data: ByteArray, mimeType: String): PhotoUploadResult {
        if (!ensureFreshAccessToken()) error("OAuth-Token abgelaufen und konnte nicht erneuert werden.")
        val filename = "${UUID.randomUUID()}.${extensionForMimeType(mimeType)}"
        val path = "/nagellacke/photos/$filename"
        val arg = """{"path":"$path","mode":"add"}"""
        val res = client.newCall(
            Request.Builder().url("$content/files/upload")
                .post(data.toRequestBody("application/octet-stream".toMediaType()))
                .header("Dropbox-API-Arg", arg)
                .build()
        ).execute()
        val ok = res.isSuccessful
        val code = res.code
        res.close()
        if (!ok) error("Foto-Upload fehlgeschlagen (HTTP $code)")
        return PhotoUploadResult(filename, path)
    }

    private fun deletePhotoBlocking(filename: String) {
        client.newCall(
            Request.Builder().url("$api/files/delete_v2")
                .post("""{"path":"/nagellacke/photos/$filename"}""".toRequestBody("application/json".toMediaType()))
                .build()
        ).execute().close()
    }

    override fun photoUrl(filename: String) = "$content/files/download?path=/nagellacke/photos/$filename"
}
