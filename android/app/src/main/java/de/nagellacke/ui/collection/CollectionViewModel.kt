package de.nagellacke.ui.collection

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import de.nagellacke.data.repo.NagellackeRepository
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
)

@HiltViewModel
class CollectionViewModel @Inject constructor(
    private val repo: NagellackeRepository,
) : ViewModel() {
    private val _filter = MutableStateFlow(FilterState())

    val uiState = combine(repo.observeData(), _filter) { data, filter ->
        val visible = sortPolishes(filterPolishes(data.polishes, filter), filter.sort)
        CollectionUiState(
            polishes   = visible,
            categories = data.customCats.filter { it.deletedAt == null },
            filter     = filter,
            loading    = false,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), CollectionUiState())

    fun setSearch(q: String)          = _filter.update { it.copy(search = q) }
    fun setStatus(s: PolishStatus?)   = _filter.update { it.copy(status = s) }
    fun setFinish(f: FinishType?)     = _filter.update { it.copy(finish = f) }
    fun setCategory(c: String)        = _filter.update { it.copy(category = c) }
    fun setSort(s: SortOption)        = _filter.update { it.copy(sort = s) }

    fun addPolish(p: Polish)          = viewModelScope.launch { repo.addPolish(p) }
    fun updatePolish(p: Polish)       = viewModelScope.launch { repo.updatePolish(p) }
    fun deletePolish(id: String)      = viewModelScope.launch { repo.deletePolish(id) }
    fun addCategory(label: String)    = viewModelScope.launch { repo.addCategory(label) }
}
