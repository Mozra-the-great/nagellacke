package de.nagellacke.ui.wishlist

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import de.nagellacke.data.repo.DisplayPrefsStore
import de.nagellacke.data.repo.NagellackeRepository
import de.nagellacke.data.repo.PhotoRepository
import de.nagellacke.data.repo.SyncConfigStore
import de.nagellacke.domain.model.Category
import de.nagellacke.domain.model.Polish
import de.nagellacke.domain.model.PolishStatus
import de.nagellacke.domain.wishlistPolishes
import de.nagellacke.ui.collection.PhotoResolution
import de.nagellacke.ui.collection.photoResolution
import kotlinx.coroutines.flow.SharingStarted
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
)

@HiltViewModel
class WishlistViewModel @Inject constructor(
    private val repo: NagellackeRepository,
    private val displayPrefsStore: DisplayPrefsStore,
    private val configStore: SyncConfigStore,
    private val photoRepository: PhotoRepository,
) : ViewModel() {

    val uiState = combine(
        repo.observeData(),
        displayPrefsStore.bottleStyle,
        configStore.configFlow,
    ) { data, bottleStyle, cfg ->
        WishlistUiState(
            polishes    = wishlistPolishes(data.polishes),
            categories  = data.customCats.filter { it.deletedAt == null },
            loading     = false,
            bottleStyle = bottleStyle,
            photoResolution = cfg.photoResolution(),
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), WishlistUiState())

    fun addPolish(p: Polish)     = viewModelScope.launch { repo.addPolish(p) }
    fun updatePolish(p: Polish)  = viewModelScope.launch { repo.updatePolish(p) }
    fun deletePolish(id: String) = viewModelScope.launch { repo.deletePolish(id) }

    /** Marks a wishlist item as bought — moves it into the regular collection. */
    fun markBought(p: Polish) = viewModelScope.launch {
        repo.updatePolish(p.copy(status = PolishStatus.Ok, updatedAt = System.currentTimeMillis()))
    }

    /** Imports a picked photo (downsamples + compresses) and returns its local filename. */
    suspend fun importPhoto(uri: Uri): String = photoRepository.importPhoto(uri)

    /** Resolves a locally-stored photo filename to a URI usable for preview before upload. */
    fun resolvePhotoUri(filename: String): Uri = photoRepository.resolveUri(filename)
}
