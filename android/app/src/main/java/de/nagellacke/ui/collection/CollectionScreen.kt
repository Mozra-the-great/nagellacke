package de.nagellacke.ui.collection

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SearchBar
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import de.nagellacke.domain.STATUS_OPTIONS
import de.nagellacke.domain.model.Polish
import de.nagellacke.ui.common.EmptyScreen
import de.nagellacke.ui.common.LoadingScreen

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CollectionScreen(vm: CollectionViewModel = hiltViewModel()) {
    val state by vm.uiState.collectAsState()
    var showForm by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<Polish?>(null) }

    Scaffold(
        topBar = { TopAppBar(title = { Text("Nagellacke", fontWeight = FontWeight.Bold) }) },
        floatingActionButton = {
            FloatingActionButton(
                onClick = { editing = null; showForm = true },
                containerColor = MaterialTheme.colorScheme.primary,
            ) {
                Icon(Icons.Default.Add, contentDescription = "Lack hinzufügen")
            }
        }
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            SearchBar(
                query = state.filter.search,
                onQueryChange = vm::setSearch,
                onSearch = {},
                active = false,
                onActiveChange = {},
                placeholder = { Text("Suchen…") },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                content = {},
            )

            Row(
                Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                STATUS_OPTIONS.forEach { opt ->
                    FilterChip(
                        selected = state.filter.status == opt,
                        onClick = { vm.setStatus(if (state.filter.status == opt) null else opt) },
                        label = { Text(opt.label) },
                    )
                }
            }

            Text(
                "${state.polishes.size} Lacke",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.outline,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )

            when {
                state.loading -> LoadingScreen()
                state.polishes.isEmpty() -> EmptyScreen("Noch keine Lacke.\nTippe + um den ersten hinzuzufügen.", "💅")
                else -> LazyVerticalGrid(
                    columns = GridCells.Fixed(2),
                    contentPadding = PaddingValues(12.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                    modifier = Modifier.weight(1f),
                ) {
                    items(state.polishes, key = { it.id }) { polish ->
                        PolishCard(polish = polish, onClick = { editing = it; showForm = true })
                    }
                }
            }
        }
    }

    if (showForm) {
        PolishFormSheet(
            polish = editing,
            categories = state.categories,
            onSave = { p -> if (editing != null) vm.updatePolish(p) else vm.addPolish(p); showForm = false },
            onDelete = editing?.let { { vm.deletePolish(it.id); showForm = false } },
            onDismiss = { showForm = false },
        )
    }
}

@Composable
fun PolishCard(polish: Polish, onClick: (Polish) -> Unit) {
    val color = runCatching { Color(android.graphics.Color.parseColor(polish.color)) }.getOrElse { Color(0xFFff6699) }
    Card(
        modifier = Modifier.fillMaxWidth().clickable { onClick(polish) },
        shape = RoundedCornerShape(16.dp),
    ) {
        Box(
            Modifier.fillMaxWidth().aspectRatio(1.2f).background(color)
                .semantics { contentDescription = "Farbvorschau ${polish.color}" }
        )
        Column(Modifier.padding(10.dp)) {
            Text(polish.name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, maxLines = 1)
            Text(polish.brand, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline, maxLines = 1)
            Text(polish.finish.label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
        }
    }
}
