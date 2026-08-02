package de.nagellacke.ui.diary

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import de.nagellacke.data.repo.NagellackeRepository
import de.nagellacke.data.repo.PhotoRepository
import de.nagellacke.data.repo.SyncConfigStore
import de.nagellacke.domain.filterManicures
import de.nagellacke.domain.model.Manicure
import de.nagellacke.domain.model.Polish
import de.nagellacke.domain.model.Sticker
import de.nagellacke.ui.collection.PhotoResolution
import de.nagellacke.ui.collection.photoResolution
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

data class DiaryUiState(
    val entries: List<Manicure> = emptyList(),
    val polishes: List<Polish> = emptyList(),
    val stickers: List<Sticker> = emptyList(),
    val loading: Boolean = true,
    /** How (or whether) photo filenames can be turned into loadable image URLs. */
    val photoResolution: PhotoResolution = PhotoResolution.None,
)

@HiltViewModel
class DiaryViewModel @Inject constructor(
    private val repo: NagellackeRepository,
    private val configStore: SyncConfigStore,
    private val photoRepository: PhotoRepository,
) : ViewModel() {

    val uiState = combine(repo.observeData(), configStore.configFlow) { data, cfg ->
        DiaryUiState(
            entries      = filterManicures(data.manicures).sortedByDescending { it.date },
            polishes     = data.polishes.filter { it.deletedAt == null && it.status.name != "Wish" },
            stickers     = data.stickers.filter { it.deletedAt == null },
            loading      = false,
            photoResolution = cfg.photoResolution(),
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), DiaryUiState())

    fun addManicure(m: Manicure)    = viewModelScope.launch { repo.addManicure(m) }
    fun updateManicure(m: Manicure) = viewModelScope.launch { repo.updateManicure(m) }
    fun deleteManicure(id: String)  = viewModelScope.launch { repo.deleteManicure(id) }

    /** Imports a picked photo (downsamples + compresses) and returns its local filename. */
    suspend fun importPhoto(uri: Uri): String = photoRepository.importPhoto(uri)

    /** Resolves a locally-stored photo filename to a URI usable for preview before upload. */
    fun resolvePhotoUri(filename: String): Uri = photoRepository.resolveUri(filename)
}
