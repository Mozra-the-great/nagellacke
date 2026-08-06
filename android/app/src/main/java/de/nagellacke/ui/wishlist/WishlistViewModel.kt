package de.nagellacke.ui.wishlist

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import de.nagellacke.data.repo.DisplayPrefsStore
import de.nagellacke.data.repo.NagellackeRepository
import de.nagellacke.data.repo.PhotoRepository
import de.nagellacke.data.repo.SyncConfigStore
import de.nagellacke.data.sync.AiClient
import de.nagellacke.data.sync.SyncManager
import de.nagellacke.data.sync.SyncProvider
import de.nagellacke.domain.AiAssistant
import de.nagellacke.domain.model.Category
import de.nagellacke.domain.model.Polish
import de.nagellacke.domain.model.PolishStatus
import de.nagellacke.domain.parseSmartCartAdded
import de.nagellacke.domain.wishlistPolishes
import de.nagellacke.ui.collection.PhotoResolution
import de.nagellacke.ui.collection.photoResolution
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

data class WishlistUiState(
    val polishes: List<Polish> = emptyList(),
    val categories: List<Category> = emptyList(),
    val loading: Boolean = true,
    val bottleStyle: Boolean = true,
    val photoResolution: PhotoResolution = PhotoResolution.None,
    /** Whether the "KI Auto-Fill" checkbox and Smart-Cart prompt should be offered. */
    val aiAvailable: Boolean = false,
)

sealed class SmartCartStatus {
    data object Idle : SmartCartStatus()
    data object Running : SmartCartStatus()
    data class Done(val added: Int) : SmartCartStatus()
    data class Error(val message: String) : SmartCartStatus()
}

@HiltViewModel
class WishlistViewModel @Inject constructor(
    private val repo: NagellackeRepository,
    private val displayPrefsStore: DisplayPrefsStore,
    private val configStore: SyncConfigStore,
    private val photoRepository: PhotoRepository,
    private val aiAssistant: AiAssistant,
    private val syncManager: SyncManager,
) : ViewModel() {

    val uiState = combine(
        repo.observeData(),
        displayPrefsStore.bottleStyle,
        configStore.configFlow,
        displayPrefsStore.aiEnabled,
    ) { data, bottleStyle, cfg, aiEnabled ->
        WishlistUiState(
            polishes    = wishlistPolishes(data.polishes),
            categories  = data.customCats.filter { it.deletedAt == null },
            loading     = false,
            bottleStyle = bottleStyle,
            photoResolution = cfg.photoResolution(),
            aiAvailable = aiEnabled && cfg?.provider == SyncProvider.Server,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), WishlistUiState())

    private val _smartCartStatus = MutableStateFlow<SmartCartStatus>(SmartCartStatus.Idle)
    val smartCartStatus: StateFlow<SmartCartStatus> = _smartCartStatus.asStateFlow()

    fun addPolish(p: Polish, autofill: Boolean = false) = viewModelScope.launch {
        repo.addPolish(p)
        if (autofill) aiAssistant.runAutofill(p.id, p.name, p.brand, p.num)
    }
    fun updatePolish(p: Polish)  = viewModelScope.launch { repo.updatePolish(p) }
    fun deletePolish(id: String) = viewModelScope.launch { repo.deletePolish(id) }

    /** Marks a wishlist item as bought — moves it into the regular collection. */
    fun markBought(p: Polish) = viewModelScope.launch {
        repo.updatePolish(p.copy(status = PolishStatus.Ok, updatedAt = System.currentTimeMillis()))
    }

    private fun aiClient(): AiClient? {
        val cfg = configStore.getConfig() ?: return null
        if (cfg.provider != SyncProvider.Server || cfg.serverUrl.isBlank()) return null
        return AiClient(cfg.serverUrl, cfg.serverToken)
    }

    /**
     * Runs a smart-cart job — unlike autofill, the job adds items directly to the *server's*
     * collection (see server's /api/ai/smart-cart), so the new items only show up locally after
     * a sync, matching web's `await appData.sync()` after a successful run.
     */
    fun runSmartCart(prompt: String) {
        val client = aiClient()
        if (client == null) {
            _smartCartStatus.value = SmartCartStatus.Error("Kein Server-Sync konfiguriert")
            return
        }
        viewModelScope.launch {
            _smartCartStatus.value = SmartCartStatus.Running
            val jobId = client.startSmartCart(prompt).getOrElse {
                _smartCartStatus.value = SmartCartStatus.Error(it.message ?: "Unbekannter Fehler")
                return@launch
            }
            val job = client.pollJob(jobId, timeoutMs = 180_000).getOrElse {
                _smartCartStatus.value = SmartCartStatus.Error(it.message ?: "Unbekannter Fehler")
                return@launch
            }
            if (job.status == "error") {
                _smartCartStatus.value = SmartCartStatus.Error(job.error ?: "Unbekannter Fehler")
                return@launch
            }
            syncManager.syncNow()
            _smartCartStatus.value = SmartCartStatus.Done(parseSmartCartAdded(job))
        }
    }

    fun resetSmartCartStatus() { _smartCartStatus.value = SmartCartStatus.Idle }

    /** Imports a picked photo (downsamples + compresses) and returns its local filename. */
    suspend fun importPhoto(uri: Uri): String = photoRepository.importPhoto(uri)

    /** Resolves a locally-stored photo filename to a URI usable for preview before upload. */
    fun resolvePhotoUri(filename: String): Uri = photoRepository.resolveUri(filename)
    fun photoExistsLocally(filename: String): Boolean = photoRepository.exists(filename)
}
