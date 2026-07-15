package de.nagellacke.ui.collection

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import de.nagellacke.data.repo.DisplayPrefsStore
import de.nagellacke.data.repo.NagellackeRepository
import de.nagellacke.data.repo.SyncConfig
import de.nagellacke.data.repo.SyncConfigStore
import de.nagellacke.data.sync.SyncProvider
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
    /** Base URL prefix for photo filenames, e.g. "https://server.com/photos/".
     *  null when no Server provider is configured (Nextcloud, local-only, etc.). */
    val photoBaseUrl: String? = null,
    /** true when a sync provider is configured but photo display isn't implemented for it yet. */
    val photosUnsupported: Boolean = false,
)

@HiltViewModel
class CollectionViewModel @Inject constructor(
    private val repo: NagellackeRepository,
    private val displayPrefsStore: DisplayPrefsStore,
    private val configStore: SyncConfigStore,
) : ViewModel() {
    private val _filter = MutableStateFlow(FilterState())

    val uiState = combine(
        repo.observeData(),
        _filter,
        displayPrefsStore.bottleStyle,
        configStore.configFlow,
    ) { data, filter, bottleStyle, cfg ->
        val visible = sortPolishes(filterPolishes(data.polishes, filter), filter.sort)
        CollectionUiState(
            polishes         = visible,
            categories       = data.customCats.filter { it.deletedAt == null },
            filter           = filter,
            loading          = false,
            bottleStyle      = bottleStyle,
            photoBaseUrl     = cfg.photoBaseUrl(),
            photosUnsupported = cfg.photosUnsupported(),
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), CollectionUiState())

    fun setSearch(q: String)         = _filter.update { it.copy(search = q) }
    fun setStatus(s: PolishStatus?)  = _filter.update { it.copy(status = s) }
    fun setFinish(f: FinishType?)    = _filter.update { it.copy(finish = f) }
    fun setCategory(c: String)       = _filter.update { it.copy(category = c) }
    fun setSort(s: SortOption)       = _filter.update { it.copy(sort = s) }

    fun addPolish(p: Polish)         = viewModelScope.launch { repo.addPolish(p) }
    fun updatePolish(p: Polish)      = viewModelScope.launch { repo.updatePolish(p) }
    fun deletePolish(id: String)     = viewModelScope.launch { repo.deletePolish(id) }
    fun addCategory(label: String)   = viewModelScope.launch { repo.addCategory(label) }
}

/** Returns the base URL for photo filenames, or null if photos cannot be loaded. */
internal fun SyncConfig?.photoBaseUrl(): String? {
    if (this == null) return null
    if (provider != SyncProvider.Server) return null
    if (serverUrl.isBlank()) return null
    return "${serverUrl.trimEnd('/')}/photos/"
}

/**
 * True when a sync provider is configured but photo display isn't implemented for it yet
 * (Nextcloud/Google Drive/OneDrive/Dropbox photo endpoints require provider-specific auth
 * that the app's image loader doesn't send — see issue #90). Used to show an explicit
 * "photo not available" indicator instead of silently falling back to the bottle icon.
 */
internal fun SyncConfig?.photosUnsupported(): Boolean =
    this != null && provider != SyncProvider.Server
