package de.nagellacke.ui.diary

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import de.nagellacke.data.repo.NagellackeRepository
import de.nagellacke.data.repo.SyncConfigStore
import de.nagellacke.domain.filterManicures
import de.nagellacke.domain.model.Manicure
import de.nagellacke.domain.model.Polish
import de.nagellacke.ui.collection.photoBaseUrl
import de.nagellacke.ui.collection.photosUnsupported
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

data class DiaryUiState(
    val entries: List<Manicure> = emptyList(),
    val polishes: List<Polish> = emptyList(),
    val loading: Boolean = true,
    /** Base URL prefix for photo filenames — null when no Server provider is configured. */
    val photoBaseUrl: String? = null,
    /** true when a sync provider is configured but photo display isn't implemented for it yet. */
    val photosUnsupported: Boolean = false,
)

@HiltViewModel
class DiaryViewModel @Inject constructor(
    private val repo: NagellackeRepository,
    private val configStore: SyncConfigStore,
) : ViewModel() {

    val uiState = combine(repo.observeData(), configStore.configFlow) { data, cfg ->
        DiaryUiState(
            entries          = filterManicures(data.manicures).sortedByDescending { it.date },
            polishes         = data.polishes.filter { it.deletedAt == null && it.status.name != "Wish" },
            loading          = false,
            photoBaseUrl     = cfg.photoBaseUrl(),
            photosUnsupported = cfg.photosUnsupported(),
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), DiaryUiState())

    fun addManicure(m: Manicure)    = viewModelScope.launch { repo.addManicure(m) }
    fun updateManicure(m: Manicure) = viewModelScope.launch { repo.updateManicure(m) }
    fun deleteManicure(id: String)  = viewModelScope.launch { repo.deleteManicure(id) }
}
