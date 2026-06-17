package de.nagellacke.data.sync

import de.nagellacke.data.repo.SyncConfig
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

class GoogleDriveAdapter(private val config: SyncConfig) : SyncAdapter {
    override val provider = SyncProvider.GoogleDrive

    private val json = Json { ignoreUnknownKeys = true }
    private val driveApi = "https://www.googleapis.com/drive/v3"
    private val uploadApi = "https://www.googleapis.com/upload/drive/v3"
    private val dataFilename = "nagellacke-data.json"
    private val photoFolder = "nagellacke-photos"

    private val client = OkHttpClient.Builder()
        .addInterceptor { chain ->
            chain.proceed(
                chain.request().newBuilder()
                    .header("Authorization", "Bearer ${config.accessToken}")
                    .build()
            )
        }
        .build()

    private suspend fun findFile(name: String, folderId: String? = null): String? {
        val q = if (folderId != null)
            "name='$name' and '$folderId' in parents and trashed=false"
        else
            "name='$name' and trashed=false"
        val res = client.newCall(
            Request.Builder().url("$driveApi/files?q=${java.net.URLEncoder.encode(q, "UTF-8")}&fields=files(id)").get().build()
        ).execute()
        val body = res.body?.string() ?: return null
        res.close()
        return runCatching { json.decodeFromString<DriveFileList>(body).files.firstOrNull()?.id }.getOrNull()
    }

    private suspend fun downloadJson(fileId: String): AppData? {
        val res = client.newCall(
            Request.Builder().url("$driveApi/files/$fileId?alt=media").get().build()
        ).execute()
        val body = res.body?.string()
        res.close()
        return if (res.isSuccessful && body != null) runCatching { json.decodeFromString<AppData>(body) }.getOrNull() else null
    }

    private suspend fun uploadJson(data: AppData, fileId: String?): String {
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
        val id = runCatching { json.decodeFromString<DriveFile>(res.body?.string() ?: "").id }.getOrElse { "" }
        res.close()
        return id
    }

    private suspend fun ensurePhotoFolder(): String {
        return findFile(photoFolder) ?: run {
            val meta = """{"name":"$photoFolder","mimeType":"application/vnd.google-apps.folder"}"""
            val res = client.newCall(
                Request.Builder().url("$driveApi/files").post(meta.toRequestBody("application/json".toMediaType())).build()
            ).execute()
            val id = runCatching { json.decodeFromString<DriveFile>(res.body?.string() ?: "").id }.getOrElse { "" }
            res.close()
            id
        }
    }

    override suspend fun sync(local: AppData): SyncResult = runCatching {
        val fileId = findFile(dataFilename)
        val remote = fileId?.let { downloadJson(it) }
        val merged = if (remote != null) mergeData(local, remote) else local
        uploadJson(merged, fileId)
        SyncResult(success = true, merged = merged)
    }.getOrElse { e -> SyncResult(success = false, merged = local, error = e.message) }

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
        val fileId = findFile(filename) ?: return
        client.newCall(Request.Builder().url("$driveApi/files/$fileId").delete().build()).execute().close()
    }

    override fun photoUrl(filename: String) = filename
}
