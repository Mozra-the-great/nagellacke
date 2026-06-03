package de.nagellacke.data.sync

import de.nagellacke.domain.model.AppData

enum class SyncProvider { Server, Nextcloud, GoogleDrive, OneDrive, Dropbox }

data class SyncResult(
    val success: Boolean,
    val merged: AppData,
    val error: String? = null,
    val lastSyncAt: Long = System.currentTimeMillis(),
)

data class PhotoUploadResult(val filename: String, val url: String)

interface SyncAdapter {
    val provider: SyncProvider
    suspend fun sync(local: AppData): SyncResult
    suspend fun uploadPhoto(data: ByteArray, mimeType: String): PhotoUploadResult
    suspend fun deletePhoto(filename: String)
    fun photoUrl(filename: String): String
}
