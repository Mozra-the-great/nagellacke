package de.nagellacke.ui.stickers

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SearchBar
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import de.nagellacke.domain.STATUS_OPTIONS
import de.nagellacke.domain.STICKER_TYPE_OPTIONS
import de.nagellacke.domain.generateId
import de.nagellacke.domain.model.PolishStatus
import de.nagellacke.domain.model.Sticker
import de.nagellacke.domain.model.StickerType
import de.nagellacke.ui.common.EmptyScreen
import de.nagellacke.ui.common.LoadingScreen

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StickersScreen(vm: StickersViewModel = hiltViewModel()) {
    val state by vm.uiState.collectAsState()
    var showForm by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<Sticker?>(null) }

    Scaffold(
        topBar = { TopAppBar(title = { Text("Sticker", fontWeight = FontWeight.Bold) }) },
        floatingActionButton = {
            FloatingActionButton(onClick = { editing = null; showForm = true }, containerColor = MaterialTheme.colorScheme.primary) {
                Icon(Icons.Default.Add, contentDescription = "Sticker hinzufügen")
            }
        }
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            SearchBar(
                query = state.search, onQueryChange = vm::setSearch, onSearch = {},
                active = false, onActiveChange = {},
                placeholder = { Text("Sticker suchen…") },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                content = {},
            )
            Text("${state.stickers.size} Sticker", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline, modifier = Modifier.padding(horizontal = 16.dp))

            when {
                state.loading -> LoadingScreen()
                state.stickers.isEmpty() -> EmptyScreen("Noch keine Sticker.\nTippe + um den ersten hinzuzufügen.", "✨")
                else -> LazyColumn(Modifier.weight(1f)) {
                    items(state.stickers, key = { it.id }) { sticker ->
                        ListItem(
                            headlineContent = { Text(sticker.name) },
                            supportingContent = { Text(listOf(sticker.brand, sticker.type.label).filter { it.isNotBlank() }.joinToString(" · ")) },
                            leadingContent = {
                                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                    sticker.colors.take(3).forEach { hex ->
                                        val c = runCatching { Color(android.graphics.Color.parseColor(hex)) }.getOrElse { Color(0xFFff6699) }
                                        Box(Modifier.size(18.dp).clip(CircleShape).background(c).semantics { contentDescription = "Farbe $hex" })
                                    }
                                }
                            },
                            trailingContent = if (sticker.rating > 0) ({ Text("★".repeat(sticker.rating), color = Color(0xFFf59e0b)) }) else null,
                            modifier = Modifier.clickable { editing = sticker; showForm = true },
                        )
                    }
                }
            }
        }
    }

    if (showForm) {
        StickerFormSheet(
            sticker = editing,
            onSave = { s -> if (editing != null) vm.updateSticker(s) else vm.addSticker(s); showForm = false },
            onDelete = editing?.let { { vm.deleteSticker(it.id); showForm = false } },
            onDismiss = { showForm = false },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun StickerFormSheet(sticker: Sticker?, onSave: (Sticker) -> Unit, onDelete: (() -> Unit)?, onDismiss: () -> Unit) {
    val now = System.currentTimeMillis()
    var name   by remember(sticker) { mutableStateOf(sticker?.name ?: "") }
    var brand  by remember(sticker) { mutableStateOf(sticker?.brand ?: "") }
    var style  by remember(sticker) { mutableStateOf(sticker?.style ?: "") }
    var type   by remember(sticker) { mutableStateOf(sticker?.type ?: StickerType.Accent) }
    var status by remember(sticker) { mutableStateOf(sticker?.status ?: PolishStatus.Ok) }
    var rating by remember(sticker) { mutableStateOf(sticker?.rating ?: 0) }
    var notes  by remember(sticker) { mutableStateOf(sticker?.notes ?: "") }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
            Text(if (sticker != null) "Bearbeiten" else "Neuer Sticker", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(bottom = 16.dp))
            OutlinedTextField(name, { name = it }, label = { Text("Name *") }, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(brand, { brand = it }, label = { Text("Marke") }, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(style, { style = it }, label = { Text("Stil") }, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(8.dp))
            Text("Typ", style = MaterialTheme.typography.labelLarge)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                STICKER_TYPE_OPTIONS.forEach { t -> FilterChip(type == t, { type = t }, label = { Text("${t.icon} ${t.label}") }) }
            }
            Text("Status", style = MaterialTheme.typography.labelLarge)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                STATUS_OPTIONS.forEach { s -> FilterChip(status == s, { status = s }, label = { Text(s.label) }) }
            }
            Text("Bewertung", style = MaterialTheme.typography.labelLarge)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                (1..5).forEach { n ->
                    Text("★", style = MaterialTheme.typography.headlineMedium,
                        color = if (n <= rating) Color(0xFFf59e0b) else MaterialTheme.colorScheme.outlineVariant,
                        modifier = Modifier.clickable { rating = if (rating == n) 0 else n }.semantics { contentDescription = "$n Sterne" })
                }
            }
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(notes, { notes = it }, label = { Text("Notizen") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
            Spacer(Modifier.height(16.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                if (onDelete != null) TextButton(onClick = onDelete) { Text("Löschen", color = MaterialTheme.colorScheme.error) }
                Spacer(Modifier.weight(1f))
                TextButton(onClick = onDismiss) { Text("Abbrechen") }
                Button(
                    onClick = { onSave(Sticker(id = sticker?.id ?: generateId(), name = name.trim(), brand = brand.trim(), style = style.trim(), type = type, status = status, rating = rating, notes = notes.trim(), colors = sticker?.colors ?: listOf("#ff6699"), createdAt = sticker?.createdAt ?: now, updatedAt = now)) },
                    enabled = name.isNotBlank(),
                ) { Text("Speichern") }
            }
            Spacer(Modifier.height(16.dp))
        }
    }
}
