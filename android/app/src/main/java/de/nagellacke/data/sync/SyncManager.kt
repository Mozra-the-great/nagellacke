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

fun createAdapter(config: SyncConfig): SyncAdapter = when (config.provider) {
    SyncProvider.Server     -> ServerAdapter(config)
    SyncProvider.Nextcloud  -> NextcloudAdapter(config)
    SyncProvider.GoogleDrive -> GoogleDriveAdapter(config)
    SyncProvider.OneDrive   -> OneDriveAdapter(config)
    SyncProvider.Dropbox    -> DropboxAdapter(config)
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
            // Reconcile against Room's current state, not the pre-request snapshot: local
            // edits made while `adapter.sync` was in flight must not be clobbered by replaceAll.
            val reconciled = mergeData(repository.getCurrentData(), result.merged)
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
