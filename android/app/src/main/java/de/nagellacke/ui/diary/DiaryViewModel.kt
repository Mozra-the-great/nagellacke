package de.nagellacke.ui.diary

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import de.nagellacke.data.repo.NagellackeRepository
import de.nagellacke.domain.filterManicures
import de.nagellacke.domain.model.Manicure
import de.nagellacke.domain.model.Polish
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

data class DiaryUiState(
    val entries: List<Manicure> = emptyList(),
    val polishes: List<Polish> = emptyList(),
    val loading: Boolean = true,
)

@HiltViewModel
class DiaryViewModel @Inject constructor(private val repo: NagellackeRepository) : ViewModel() {
    val uiState = repo.observeData().map { data ->
        DiaryUiState(
            entries = filterManicures(data.manicures).sortedByDescending { it.date },
            polishes = data.polishes.filter { it.deletedAt == null && it.status.name != "Wish" },
            loading = false,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), DiaryUiState())

    fun addManicure(m: Manicure)    = viewModelScope.launch { repo.addManicure(m) }
    fun updateManicure(m: Manicure) = viewModelScope.launch { repo.updateManicure(m) }
    fun deleteManicure(id: String)  = viewModelScope.launch { repo.deleteManicure(id) }
}
