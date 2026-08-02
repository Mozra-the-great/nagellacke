package de.nagellacke.ui.collection

import android.net.Uri
import android.util.Base64
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import de.nagellacke.data.repo.DisplayPrefsStore
import de.nagellacke.data.repo.NagellackeRepository
import de.nagellacke.data.repo.PhotoRepository
import de.nagellacke.data.repo.SyncConfig
import de.nagellacke.data.repo.SyncConfigStore
import de.nagellacke.data.sync.DropboxAdapter
import de.nagellacke.data.sync.NextcloudAdapter
import de.nagellacke.data.sync.OneDriveAdapter
import de.nagellacke.data.sync.ServerAdapter
import de.nagellacke.data.sync.SyncAdapter
import de.nagellacke.data.sync.SyncProvider
import de.nagellacke.domain.AiAssistant
import de.nagellacke.domain.filterPolishes
import de.nagellacke.domain.model.Category
import de.nagellacke.domain.model.FilterState
import de.nagellacke.domain.model.FinishType
import de.nagellacke.domain.model.Polish
import de.nagellacke.domain.model.PolishStatus
import de.nagellacke.domain.model.SortOption
import de.nagellacke.domain.sortPolishes
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class CollectionUiState(
    val polishes: List<Polish> = emptyList(),
    val categories: List<Category> = emptyList(),
    val filter: FilterState = FilterState(),
    val loading: Boolean = true,
    val error: String? = null,
    /** true = show nail-bottle SVG, false = plain colour swatch */
    val bottleStyle: Boolean = true,
    /** How (or whether) photo filenames can be turned into loadable image URLs
     *  for the currently configured sync provider. */
    val photoResolution: PhotoResolution = PhotoResolution.None,
    /** Whether the "KI Auto-Fill" checkbox should be offered on the new-polish form. */
    val aiAvailable: Boolean = false,
)

@HiltViewModel
class CollectionViewModel @Inject constructor(
    private val repo: NagellackeRepository,
    private val displayPrefsStore: DisplayPrefsStore,
    private val configStore: SyncConfigStore,
    private val photoRepository: PhotoRepository,
    private val aiAssistant: AiAssistant,
) : ViewModel() {
    private val _filter = MutableStateFlow(FilterState())

    val uiState = combine(
        repo.observeData(),
        _filter,
        displayPrefsStore.bottleStyle,
        configStore.configFlow,
        displayPrefsStore.aiEnabled,
    ) { data, filter, bottleStyle, cfg, aiEnabled ->
        val visible = sortPolishes(filterPolishes(data.polishes, filter), filter.sort)
        CollectionUiState(
            polishes     = visible,
            categories   = data.customCats.filter { it.deletedAt == null },
            filter       = filter,
            loading      = false,
            bottleStyle  = bottleStyle,
            photoResolution = cfg.photoResolution(),
            aiAvailable  = aiEnabled && cfg?.provider == SyncProvider.Server,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), CollectionUiState())

    fun setSearch(q: String)         = _filter.update { it.copy(search = q) }
    fun setStatus(s: PolishStatus?)  = _filter.update { it.copy(status = s) }
    fun setFinish(f: FinishType?)    = _filter.update { it.copy(finish = f) }
    fun setCategory(c: String)       = _filter.update { it.copy(category = c) }
    fun setSort(s: SortOption)       = _filter.update { it.copy(sort = s) }

    fun addPolish(p: Polish, autofill: Boolean = false) = viewModelScope.launch {
        repo.addPolish(p)
        if (autofill) aiAssistant.runAutofill(p.id, p.name, p.brand, p.num)
    }
    fun updatePolish(p: Polish)      = viewModelScope.launch { repo.updatePolish(p) }
    fun deletePolish(id: String)     = viewModelScope.launch { repo.deletePolish(id) }
    fun addCategory(label: String)   = viewModelScope.launch { repo.addCategory(label) }

    /** Imports a picked photo (downsamples + compresses) and returns its local filename. */
    suspend fun importPhoto(uri: Uri): String = photoRepository.importPhoto(uri)

    /** Resolves a locally-stored photo filename to a URI usable for preview before upload. */
    fun resolvePhotoUri(filename: String): Uri = photoRepository.resolveUri(filename)
}

/**
 * Describes how photo filenames can be turned into a loadable image URL for the
 * currently configured sync provider.
 */
sealed class PhotoResolution {
    /** No provider configured, or the configured provider has no usable photo storage yet. */
    object None : PhotoResolution()

    /**
     * Filenames can be resolved to a URL; [authHeader], if non-null, must be sent with the request.
     *
     * Equality is keyed on the sync config rather than on the URL-building lambda: function
     * references have no stable equality, so a lambda-carrying data class would compare unequal
     * on every emission, invalidating the enclosing UI state — and with it every cached
     * ImageRequest — on any unrelated collection change.
     */
    class Resolvable(
        private val config: SyncConfig,
        val authHeader: String?,
        private val adapter: SyncAdapter,
    ) : PhotoResolution() {
        fun urlFor(filename: String): String = adapter.photoUrl(filename)

        override fun equals(other: Any?): Boolean =
            other is Resolvable && other.config == config && other.authHeader == authHeader

        override fun hashCode(): Int = 31 * config.hashCode() + (authHeader?.hashCode() ?: 0)
    }

    /** A provider is configured, but photo URLs cannot be resolved for it (Google Drive). */
    object Unsupported : PhotoResolution()
}

/** Resolves how (or whether) this sync config's photo filenames can be loaded as images. */
internal fun SyncConfig?.photoResolution(): PhotoResolution {
    val cfg = this ?: return PhotoResolution.None
    return when (cfg.provider) {
        SyncProvider.Server -> {
            if (cfg.serverUrl.isBlank()) PhotoResolution.None
            else {
                PhotoResolution.Resolvable(cfg, authHeader = null, adapter = ServerAdapter(cfg))
            }
        }
        SyncProvider.Nextcloud -> {
            if (cfg.nextcloudUrl.isBlank() || cfg.nextcloudUser.isBlank()) PhotoResolution.None
            else {
                val authHeader = "Basic " + Base64.encodeToString(
                    "${cfg.nextcloudUser}:${cfg.nextcloudPassword}".toByteArray(),
                    Base64.NO_WRAP,
                )
                PhotoResolution.Resolvable(cfg, authHeader = authHeader, adapter = NextcloudAdapter(cfg))
            }
        }
        SyncProvider.OneDrive -> {
            if (cfg.accessToken.isBlank()) PhotoResolution.None
            else {
                PhotoResolution.Resolvable(cfg, authHeader = "Bearer ${cfg.accessToken}", adapter = OneDriveAdapter(cfg))
            }
        }
        SyncProvider.Dropbox -> {
            if (cfg.accessToken.isBlank()) PhotoResolution.None
            else {
                PhotoResolution.Resolvable(cfg, authHeader = "Bearer ${cfg.accessToken}", adapter = DropboxAdapter(cfg))
            }
        }
        // Resolving a Google Drive filename to a downloadable URL requires an async
        // file-ID lookup that doesn't fit this synchronous resolution shape (#90).
        SyncProvider.GoogleDrive -> PhotoResolution.Unsupported
    }
}
