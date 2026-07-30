package de.nagellacke.data.sync

import de.nagellacke.data.repo.SyncConfig
import de.nagellacke.data.repo.SyncConfigStore
import de.nagellacke.ui.settings.OAuthClientIds
import kotlinx.serialization.encodeToString
import de.nagellacke.domain.mergeData
import de.nagellacke.domain.model.AppData
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.UUID

@Serializable data class DriveFileList(val files: List<DriveFile>)
@Serializable data class DriveFile(val id: String, val name: String = "")

class GoogleDriveAdapter(
    private val config: SyncConfig,
    private val configStore: SyncConfigStore? = null,
) : SyncAdapter {
    override val provider = SyncProvider.GoogleDrive

    private val json = Json { ignoreUnknownKeys = true }
    private val driveApi = "https://www.googleapis.com/drive/v3"
    private val uploadApi = "https://www.googleapis.com/upload/drive/v3"
    private val dataFilename = "nagellacke-data.json"
    private val photoFolder = "nagellacke-photos"
    private val tokenEndpoint = "https://oauth2.googleapis.com/token"

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
        val refreshed = refreshOAuthToken(plainClient, json, tokenEndpoint, OAuthClientIds.Google, refreshToken) ?: return false
        accessToken = refreshed.accessToken
        configStore?.saveTokens(provider, refreshed.accessToken, refreshed.refreshToken ?: refreshToken, now + refreshed.expiresIn * 1000)
        return true
    }

    /** Result of looking up a file by name — distinguishes "doesn't exist" from "the lookup failed". */
    private sealed class FindFileResult {
        data class Found(val id: String) : FindFileResult()
        object NotFound : FindFileResult()
        data class Error(val message: String) : FindFileResult()
    }

    private fun findFile(name: String, folderId: String? = null): FindFileResult {
        val q = if (folderId != null)
            "name='$name' and '$folderId' in parents and trashed=false"
        else
            "name='$name' and trashed=false"
        val res = client.newCall(
            Request.Builder().url("$driveApi/files?q=${java.net.URLEncoder.encode(q, "UTF-8")}&fields=files(id)").get().build()
        ).execute()
        return res.use { r ->
            if (!r.isSuccessful) {
                FindFileResult.Error("Lesefehler (HTTP ${r.code})")
            } else {
                val body = r.body?.string()
                val id = body?.let { runCatching { json.decodeFromString<DriveFileList>(it).files.firstOrNull()?.id }.getOrNull() }
                if (id != null) FindFileResult.Found(id) else FindFileResult.NotFound
            }
        }
    }

    private fun downloadJson(fileId: String): RemoteFetchResult {
        val res = client.newCall(
            Request.Builder().url("$driveApi/files/$fileId?alt=media").get().build()
        ).execute()
        return res.use { r ->
            when {
                r.code == 404 -> RemoteFetchResult.NotFound
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

    private data class WriteResult(val success: Boolean, val code: Int)

    private fun uploadJson(data: AppData, fileId: String?): WriteResult {
        val body = json.encodeToString(data).toRequestBody("application/json".toMediaType())
        val res = if (fileId != null) {
            client.newCall(Request.Builder().url("$uploadApi/files/$fileId?uploadType=media").method("PATCH", body).build()).execute()
        } else {
            val meta = """{"name":"$dataFilename","mimeType":"application/json"}"""
            val multipart = MultipartBody.Builder("boundary")
                .setType(MultipartBody.FORM)
                .addPart(meta.toRequestBody("application/json".toMediaType()))
                .addPart(body)
                .build()
            client.newCall(Request.Builder().url("$uploadApi/files?uploadType=multipart").post(multipart).build()).execute()
        }
        return res.use { WriteResult(it.isSuccessful, it.code) }
    }

    private fun ensurePhotoFolder(): String {
        val existing = findFile(photoFolder)
        if (existing is FindFileResult.Found) return existing.id
        val meta = """{"name":"$photoFolder","mimeType":"application/vnd.google-apps.folder"}"""
        val res = client.newCall(
            Request.Builder().url("$driveApi/files").post(meta.toRequestBody("application/json".toMediaType())).build()
        ).execute()
        val id = runCatching { json.decodeFromString<DriveFile>(res.body?.string() ?: "").id }.getOrElse { "" }
        res.close()
        return id
    }

    override suspend fun sync(local: AppData): SyncResult {
        if (!ensureFreshAccessToken()) {
            return SyncResult(success = false, merged = local, error = "OAuth-Token abgelaufen und konnte nicht erneuert werden. Bitte erneut anmelden.")
        }
        return try {
            val findResult = findFile(dataFilename)
            if (findResult is FindFileResult.Error) {
                return SyncResult(success = false, merged = local, error = findResult.message)
            }
            val fileId = (findResult as? FindFileResult.Found)?.id
            val remoteFetch = if (fileId != null) downloadJson(fileId) else RemoteFetchResult.NotFound
            if (remoteFetch is RemoteFetchResult.Error) {
                return SyncResult(success = false, merged = local, error = remoteFetch.message)
            }
            val remote = (remoteFetch as? RemoteFetchResult.Found)?.data
            val merged = if (remote != null) mergeData(local, remote) else local
            val uploadResult = uploadJson(merged, fileId)
            if (!uploadResult.success) {
                SyncResult(success = false, merged = local, error = "Schreibfehler (HTTP ${uploadResult.code})")
            } else {
                SyncResult(success = true, merged = merged)
            }
        } catch (e: Exception) {
            SyncResult(success = false, merged = local, error = e.message)
        }
    }

    override suspend fun uploadPhoto(data: ByteArray, mimeType: String): PhotoUploadResult {
        val folderId = ensurePhotoFolder()
        val filename = "${UUID.randomUUID()}.jpg"
        val meta = """{"name":"$filename","parents":["$folderId"]}"""
        val multipart = MultipartBody.Builder("boundary")
            .setType(MultipartBody.FORM)
            .addPart(meta.toRequestBody("application/json".toMediaType()))
            .addPart(data.toRequestBody(mimeType.toMediaType()))
            .build()
        val res = client.newCall(
            Request.Builder().url("$uploadApi/files?uploadType=multipart").post(multipart).build()
        ).execute()
        val id = runCatching { json.decodeFromString<DriveFile>(res.body?.string() ?: "").id }.getOrElse { "" }
        res.close()
        return PhotoUploadResult(filename, "$driveApi/files/$id?alt=media")
    }

    override suspend fun deletePhoto(filename: String) {
        val found = findFile(filename) as? FindFileResult.Found ?: return
        client.newCall(Request.Builder().url("$driveApi/files/${found.id}").delete().build()).execute().close()
    }

    // Resolving a filename to a downloadable URL requires an async file-ID lookup (see findFile())
    // that doesn't fit this synchronous interface method. Photo display is intentionally left
    // unresolved for Google Drive; the UI shows an explicit "not supported" indicator instead (#90).
    override fun photoUrl(filename: String) = filename
}
