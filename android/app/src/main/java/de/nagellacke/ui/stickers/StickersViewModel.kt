package de.nagellacke.ui.stickers

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import de.nagellacke.data.repo.NagellackeRepository
import de.nagellacke.data.repo.SyncConfigStore
import de.nagellacke.domain.filterStickers
import de.nagellacke.domain.model.Sticker
import de.nagellacke.ui.collection.photoBaseUrl
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class StickersUiState(
    val stickers: List<Sticker> = emptyList(),
    val search: String = "",
    val loading: Boolean = true,
    /** Base URL prefix for photo filenames — null when no Server provider is configured. */
    val photoBaseUrl: String? = null,
)

@HiltViewModel
class StickersViewModel @Inject constructor(
    private val repo: NagellackeRepository,
    private val configStore: SyncConfigStore,
) : ViewModel() {
    private val _search = MutableStateFlow("")

    val uiState = combine(repo.observeData(), _search, configStore.configFlow) { data, search, cfg ->
        StickersUiState(
            stickers     = filterStickers(data.stickers, search),
            search       = search,
            loading      = false,
            photoBaseUrl = cfg.photoBaseUrl(),
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), StickersUiState())

    fun setSearch(q: String)       = _search.update { q }
    fun addSticker(s: Sticker)     = viewModelScope.launch { repo.addSticker(s) }
    fun updateSticker(s: Sticker)  = viewModelScope.launch { repo.updateSticker(s) }
    fun deleteSticker(id: String)  = viewModelScope.launch { repo.deleteSticker(id) }
}
