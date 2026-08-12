package de.nagellacke.data.sync

import android.content.Context
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
import de.nagellacke.data.repo.SyncConfig
import de.nagellacke.data.repo.SyncConfigStore
import de.nagellacke.domain.mergeData
import de.nagellacke.domain.purgeOldDeleted
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

fun createAdapter(config: SyncConfig, configStore: SyncConfigStore? = null): SyncAdapter = when (config.provider) {
    SyncProvider.Server     -> ServerAdapter(config, configStore)
    SyncProvider.Nextcloud  -> NextcloudAdapter(config)
    SyncProvider.GoogleDrive -> GoogleDriveAdapter(config, configStore)
    SyncProvider.OneDrive   -> OneDriveAdapter(config, configStore)
    SyncProvider.Dropbox    -> DropboxAdapter(config, configStore)
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
        val adapter = createAdapter(config, configStore)
        val local = repository.getCurrentData()
        val result = adapter.sync(local)
        if (result.success) {
            // The local DB can change while the network round trip above is in flight. Re-read it
            // and, if it did, fold those edits into the synced result instead of silently
            // overwriting them with the pre-request snapshot (#88).
            val latestLocal = repository.getCurrentData()
            val reconciled = if (latestLocal != local) mergeData(latestLocal, result.merged) else result.merged
            val purged = purgeOldDeleted(reconciled)
            repository.replaceAll(purged)
            return result.copy(merged = purged)
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
