package de.nagellacke.ui.settings

import android.content.Context
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import de.nagellacke.data.repo.DisplayPrefsStore
import de.nagellacke.data.repo.ExportImportRepository
import de.nagellacke.data.repo.ExportSummary
import de.nagellacke.data.repo.ImportSummary
import de.nagellacke.data.repo.NagellackeRepository
import de.nagellacke.data.repo.SyncConfig
import de.nagellacke.data.repo.SyncConfigStore
import de.nagellacke.data.sync.AiClient
import de.nagellacke.data.sync.AiSettingsDto
import de.nagellacke.data.sync.AuthRepository
import de.nagellacke.data.sync.AuthResult
import de.nagellacke.data.sync.LoginOutcome
import de.nagellacke.data.sync.PhotoTokenCache
import de.nagellacke.data.sync.ReportsClient
import de.nagellacke.data.sync.ServerAdapter
import de.nagellacke.data.sync.SaveAiSettingsRequest
import de.nagellacke.data.sync.SaveGeminiDto
import de.nagellacke.data.sync.SaveOpenRouterDto
import de.nagellacke.data.sync.SaveWebSearchDto
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

private data class SettingsExtras(
    val reportSchedule: ReportScheduleState,
    val aiEnabled: Boolean,
    val aiSettings: AiSettingsDto?,
    val role: String?,
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
    /** Local opt-in for the AI features UI (Autofill, Smart-Cart, this section) — independent of provider config. */
    val aiEnabled: Boolean = false,
    val aiSettings: AiSettingsDto? = null,
    /**
     * Role of the signed-in account, or null when unknown — offline, no server sync, or a
     * server predating #173. Null must read as "unknown", never as "not an admin".
     */
    val role: String? = null,
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val repo: NagellackeRepository,
    private val configStore: SyncConfigStore,
    private val syncManager: SyncManager,
    private val displayPrefsStore: DisplayPrefsStore,
    private val exportImportRepo: ExportImportRepository,
    @ApplicationContext private val context: Context,
) : ViewModel() {
    private val _syncState    = MutableStateFlow(Triple(false, null as String?, null as Long?))
    private val _configVersion = MutableStateFlow(0)
    private val _reportSchedule = MutableStateFlow(ReportScheduleState())
    private val _aiSettings = MutableStateFlow<AiSettingsDto?>(null)
    private val _role = MutableStateFlow<String?>(null)

    private val extras = combine(_reportSchedule, displayPrefsStore.aiEnabled, _aiSettings, _role) { rs, aiEnabled, aiSettings, role ->
        SettingsExtras(rs, aiEnabled, aiSettings, role)
    }

    val uiState = combine(
        repo.observeData(),
        _syncState,
        _configVersion,
        displayPrefsStore.bottleStyle,
        extras,
    ) { data, syncTriple, _, bottleStyle, ex ->
        val cfg = configStore.getConfig()
        SettingsUiState(
            polishCount   = data.polishes.count  { it.deletedAt == null },
            stickerCount  = data.stickers.count  { it.deletedAt == null },
            manicureCount = data.manicures.count { it.deletedAt == null },
            syncConfig    = cfg,
            syncing       = syncTriple.first,
            syncError     = syncTriple.second,
            lastSyncAt    = syncTriple.third,
            httpWarning   = isCleartextUrl(cfg?.serverUrl ?: ""),
            bottleStyle   = bottleStyle,
            photoResolution = cfg.photoResolution(),
            reportSchedule = ex.reportSchedule,
            aiEnabled     = ex.aiEnabled,
            aiSettings    = ex.aiSettings,
            role          = ex.role,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), SettingsUiState())

    init {
        loadReportSchedule()
        loadAiSettings()
        loadRole()
    }

    private fun notifyConfigChanged() {
        // The signed-in identity just changed (connected, disconnected or switched
        // provider), so any photo token still cached belongs to the previous one.
        // Deliberately not done in SyncConfigStore.saveConfig(): that also runs on
        // every access-token refresh, where dropping the photo token would blank out
        // images until the next sync re-mints one.
        PhotoTokenCache.shared.clear()
        _configVersion.update { it + 1 }
        _reportSchedule.value = ReportScheduleState()
        _aiSettings.value = null
        _role.value = null
        loadReportSchedule()
        loadAiSettings()
        loadRole()
    }

    fun saveServerConfig(url: String, token: String, refreshToken: String = "") {
        configStore.saveConfig(SyncConfig(provider = SyncProvider.Server, serverUrl = url, serverToken = token, serverRefreshToken = refreshToken))
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

    suspend fun serverLogin(url: String, username: String, password: String): Result<LoginOutcome> =
        runCatching { AuthRepository(url).login(username, password) }

    /** Finishes a 2FA login with a TOTP or recovery code (#227). */
    suspend fun serverVerifyMfa(url: String, challengeToken: String, code: String): Result<AuthResult> =
        runCatching { AuthRepository(url).verifyMfa(challengeToken, code) }

    suspend fun serverRegister(url: String, username: String, password: String): Result<AuthResult> =
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

    fun setAiEnabled(value: Boolean) = displayPrefsStore.setAiEnabled(value)

    private fun aiClient(): AiClient? {
        val cfg = configStore.getConfig() ?: return null
        if (cfg.provider != SyncProvider.Server || cfg.serverUrl.isBlank()) return null
        return AiClient(cfg.serverUrl, cfg.serverToken)
    }

    /**
     * Reads the account's role from GET /api/auth/me so the UI can hide what the server
     * would refuse anyway (#243). Stays null on any failure — see SettingsUiState.role.
     */
    fun loadRole() {
        val cfg = configStore.getConfig() ?: return
        if (cfg.provider != SyncProvider.Server || cfg.serverUrl.isBlank() || cfg.serverToken.isBlank()) return
        viewModelScope.launch {
            _role.value = ServerAdapter(cfg, configStore).fetchRole()
        }
    }

    fun loadAiSettings() {
        val client = aiClient() ?: return
        viewModelScope.launch {
            client.getSettings().onSuccess { dto -> _aiSettings.value = dto }
        }
    }

    suspend fun saveAiSettings(
        provider: String,
        openrouterKey: String, openrouterModel: String, openrouterFreeOnly: Boolean,
        geminiKey: String, geminiModel: String,
        searchBackend: String, searxngUrl: String, braveKey: String,
    ): Result<Unit> {
        val client = aiClient() ?: return Result.failure(IllegalStateException("Kein Server-Sync konfiguriert"))
        val result = client.saveSettings(
            SaveAiSettingsRequest(
                provider = provider,
                openrouter = SaveOpenRouterDto(apiKey = openrouterKey.ifBlank { null }, model = openrouterModel, freeOnly = openrouterFreeOnly),
                gemini = SaveGeminiDto(apiKey = geminiKey.ifBlank { null }, model = geminiModel),
                webSearch = SaveWebSearchDto(backend = searchBackend, searxngUrl = searxngUrl, braveApiKey = braveKey.ifBlank { null }),
            ),
        )
        if (result.isSuccess) loadAiSettings()
        return result
    }

    suspend fun exportZip(uri: Uri): Result<ExportSummary> = runCatching {
        context.contentResolver.openOutputStream(uri)?.use { out -> exportImportRepo.exportZip(out) }
            ?: error("Konnte Datei nicht zum Schreiben öffnen")
    }

    suspend fun importZip(uri: Uri): Result<ImportSummary> {
        val input = context.contentResolver.openInputStream(uri)
            ?: return Result.failure(IllegalStateException("Konnte Datei nicht öffnen"))
        return input.use { exportImportRepo.importZip(it) }
    }
}
