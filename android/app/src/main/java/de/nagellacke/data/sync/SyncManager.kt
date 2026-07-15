package de.nagellacke.data.sync

import android.content.Context
import android.net.Uri
import androidx.hilt.work.HiltWorker
import dagger.hilt.android.qualifiers.ApplicationContext
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import de.nagellacke.data.repo.NagellackeRepository
import de.nagellacke.data.repo.PhotoRepository
import de.nagellacke.data.repo.SyncConfig
import de.nagellacke.data.repo.SyncConfigStore
import de.nagellacke.domain.purgeOldDeleted
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

fun createAdapter(config: SyncConfig): SyncAdapter = when (config.provider) {
    SyncProvider.Server     -> ServerAdapter(config)
    SyncProvider.Nextcloud  -> NextcloudAdapter(config)
    SyncProvider.GoogleDrive -> GoogleDriveAdapter(config)
    SyncProvider.OneDrive   -> OneDriveAdapter(config)
    SyncProvider.Dropbox    -> DropboxAdapter(config)
}

/**
 * Imports [uri] into local storage and, if a sync provider is configured, uploads it right away
 * so the returned filename is immediately resolvable via the provider's photo URL (matching how
 * the collection/sticker/diary lists render photos). Falls back to the local filename when no
 * provider is configured or the upload fails, so the picked photo is never silently dropped.
 */
suspend fun uploadPickedPhoto(uri: Uri, photoRepository: PhotoRepository, configStore: SyncConfigStore): String {
    val localFilename = photoRepository.importPhoto(uri)
    val config = configStore.getConfig() ?: return localFilename
    return runCatching {
        val adapter = createAdapter(config)
        val bytes = photoRepository.readBytes(localFilename)
        val result = adapter.uploadPhoto(bytes, "image/jpeg")
        photoRepository.delete(localFilename)
        result.filename
    }.getOrElse { localFilename }
}

@Singleton
class SyncManager @Inject constructor(
    private val repository: NagellackeRepository,
    private val configStore: SyncConfigStore,
    @ApplicationContext private val context: Context,
) {
    fun schedulePeriodicSync() {
        val request = PeriodicWorkRequestBuilder<SyncWorker>(6, TimeUnit.HOURS)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            "nagellacke_sync",
            ExistingPeriodicWorkPolicy.KEEP,
            request,
        )
    }

    suspend fun syncNow(): SyncResult {
        val config = configStore.getConfig() ?: return SyncResult(
            success = false, merged = repository.getCurrentData(), error = "Kein Sync konfiguriert"
        )
        val adapter = createAdapter(config)
        val local = repository.getCurrentData()
        val result = adapter.sync(local)
        if (result.success) {
            val purged = purgeOldDeleted(result.merged)
            repository.replaceAll(purged)
        }
        return result
    }
}

@HiltWorker
class SyncWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val syncManager: SyncManager,
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val result = syncManager.syncNow()
        return if (result.success) Result.success() else Result.retry()
    }
}
