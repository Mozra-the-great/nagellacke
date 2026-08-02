package de.nagellacke.ui.settings

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import de.nagellacke.data.repo.DisplayPrefsStore
import de.nagellacke.data.repo.NagellackeRepository
import de.nagellacke.data.repo.SyncConfig
import de.nagellacke.data.repo.SyncConfigStore
import de.nagellacke.data.sync.AuthRepository
import de.nagellacke.data.sync.ReportsClient
import de.nagellacke.data.sync.SyncManager
import de.nagellacke.data.sync.SyncProvider
import de.nagellacke.domain.ReportPeriod
import de.nagellacke.domain.generateReportHtml
import de.nagellacke.ui.collection.PhotoResolution
import de.nagellacke.ui.collection.photoResolution
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.LocalDate
import javax.inject.Inject

data class ReportScheduleState(
    val smtpConfigured: Boolean = false,
    val enabled: Boolean = false,
    val frequency: String = "weekly",
    val toEmail: String = "",
    val loaded: Boolean = false,
)

data class SettingsUiState(
    val polishCount: Int = 0,
    val stickerCount: Int = 0,
    val manicureCount: Int = 0,
    val syncConfig: SyncConfig? = null,
    val syncing: Boolean = false,
    val syncError: String? = null,
    val lastSyncAt: Long? = null,
    val httpWarning: Boolean = false,
    /** true = nail-bottle SVG, false = plain colour swatch on polish cards */
    val bottleStyle: Boolean = true,
    val photoResolution: PhotoResolution = PhotoResolution.None,
    val reportSchedule: ReportScheduleState = ReportScheduleState(),
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val repo: NagellackeRepository,
    private val configStore: SyncConfigStore,
    private val syncManager: SyncManager,
    private val displayPrefsStore: DisplayPrefsStore,
    @ApplicationContext private val context: Context,
) : ViewModel() {
    private val _syncState    = MutableStateFlow(Triple(false, null as String?, null as Long?))
    private val _configVersion = MutableStateFlow(0)
    private val _reportSchedule = MutableStateFlow(ReportScheduleState())

    val uiState = combine(
        repo.observeData(),
        _syncState,
        _configVersion,
        displayPrefsStore.bottleStyle,
        _reportSchedule,
    ) { data, syncTriple, _, bottleStyle, reportSchedule ->
        val cfg = configStore.getConfig()
        SettingsUiState(
            polishCount   = data.polishes.count  { it.deletedAt == null },
            stickerCount  = data.stickers.count  { it.deletedAt == null },
            manicureCount = data.manicures.count { it.deletedAt == null },
            syncConfig    = cfg,
            syncing       = syncTriple.first,
            syncError     = syncTriple.second,
            lastSyncAt    = syncTriple.third,
            httpWarning   = cfg?.serverUrl?.startsWith("http://") == true,
            bottleStyle   = bottleStyle,
            photoResolution = cfg.photoResolution(),
            reportSchedule = reportSchedule,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), SettingsUiState())

    init {
        loadReportSchedule()
    }

    private fun notifyConfigChanged() {
        _configVersion.update { it + 1 }
        _reportSchedule.value = ReportScheduleState()
        loadReportSchedule()
    }

    fun saveServerConfig(url: String, token: String) {
        configStore.saveConfig(SyncConfig(provider = SyncProvider.Server, serverUrl = url, serverToken = token))
        notifyConfigChanged()
    }

    fun saveNextcloudConfig(url: String, user: String, pass: String) {
        configStore.saveConfig(SyncConfig(provider = SyncProvider.Nextcloud, nextcloudUrl = url, nextcloudUser = user, nextcloudPassword = pass))
        notifyConfigChanged()
    }

    fun saveOAuthConfig(provider: SyncProvider, accessToken: String, refreshToken: String, expiry: Long) {
        configStore.saveTokens(provider, accessToken, refreshToken, expiry)
        notifyConfigChanged()
    }

    fun clearConfig() {
        configStore.clearConfig()
        notifyConfigChanged()
    }

    fun setBottleStyle(value: Boolean) {
        displayPrefsStore.setBottleStyle(value)
    }

    fun syncNow() = viewModelScope.launch {
        _syncState.update { it.copy(first = true, second = null) }
        val result = syncManager.syncNow()
        _syncState.update { Triple(false, result.error, if (result.success) System.currentTimeMillis() else null) }
    }

    suspend fun serverLogin(url: String, username: String, password: String): Result<String> =
        runCatching { AuthRepository(url).login(username, password) }

    suspend fun serverRegister(url: String, username: String, password: String): Result<String> =
        runCatching { AuthRepository(url).register(username, password) }

    /**
     * Renders a report entirely from the local collection, matching the web app's "Bericht
     * erstellen" — no server round-trip needed for the preview, only for email delivery.
     */
    suspend fun buildReportHtml(period: ReportPeriod, date: LocalDate): String {
        val data = repo.observeData().first()
        val resolution = configStore.getConfig().photoResolution()
        return generateReportHtml(data, period, date) { filename ->
            (resolution as? PhotoResolution.Resolvable)?.urlFor(filename)
        }
    }

    private fun reportsClient(): ReportsClient? {
        val cfg = configStore.getConfig() ?: return null
        if (cfg.provider != SyncProvider.Server || cfg.serverUrl.isBlank()) return null
        return ReportsClient(cfg.serverUrl, cfg.serverToken)
    }

    fun loadReportSchedule() {
        val client = reportsClient() ?: return
        viewModelScope.launch {
            client.getSchedule().onSuccess { resp ->
                _reportSchedule.update {
                    ReportScheduleState(
                        smtpConfigured = resp.smtpConfigured,
                        enabled = resp.config?.enabled ?: false,
                        frequency = resp.config?.frequency ?: "weekly",
                        toEmail = resp.config?.toEmail ?: "",
                        loaded = true,
                    )
                }
            }
        }
    }

    suspend fun sendReportEmail(period: String, date: String, toEmail: String): Result<Unit> {
        val client = reportsClient() ?: return Result.failure(IllegalStateException("Kein Server-Sync konfiguriert"))
        return client.sendReport(period, date, toEmail)
    }

    suspend fun saveReportSchedule(enabled: Boolean, frequency: String, toEmail: String): Result<Unit> {
        val client = reportsClient() ?: return Result.failure(IllegalStateException("Kein Server-Sync konfiguriert"))
        val result = client.saveSchedule(enabled, frequency, toEmail)
        if (result.isSuccess) {
            _reportSchedule.update { it.copy(enabled = enabled, frequency = frequency, toEmail = toEmail) }
        }
        return result
    }
}
