package de.nagellacke.ui.diary

import android.net.Uri
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.Button
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberDatePickerState
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import coil.compose.AsyncImage
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import de.nagellacke.domain.generateId
import de.nagellacke.domain.model.Manicure
import de.nagellacke.domain.model.Polish
import de.nagellacke.ui.common.EmptyScreen
import de.nagellacke.ui.common.LoadingScreen
import de.nagellacke.ui.common.PhotoPickerField
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DiaryScreen(vm: DiaryViewModel = hiltViewModel()) {
    val state by vm.uiState.collectAsState()
    var showForm by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<Manicure?>(null) }

    Scaffold(
        topBar = { TopAppBar(title = { Text("Tagebuch", fontWeight = FontWeight.Bold) }) },
        floatingActionButton = {
            FloatingActionButton(onClick = { editing = null; showForm = true }, containerColor = MaterialTheme.colorScheme.primary) {
                Icon(Icons.Default.Add, contentDescription = "Eintrag hinzufügen")
            }
        }
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            Text("${state.entries.size} Einträge", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline, modifier = Modifier.padding(horizontal = 16.dp))

            when {
                state.loading -> LoadingScreen()
                state.entries.isEmpty() -> EmptyScreen("Noch keine Maniküren.\nTippe + um den ersten Eintrag zu erstellen.", "📖")
                else -> LazyColumn(Modifier.weight(1f)) {
                    items(state.entries, key = { it.id }) { entry ->
                        val polishes = state.polishes.filter { entry.polishIds.contains(it.id) }
                        val photoUrl = state.photoBaseUrl?.let { base ->
                            entry.photo?.let { "$base$it" }
                        }
                        ListItem(
                            headlineContent   = { Text(formatDate(entry.date), color = MaterialTheme.colorScheme.primary) },
                            supportingContent = { Text(entry.notes.ifBlank { polishes.joinToString(", ") { it.name }.take(60) }) },
                            leadingContent    = {
                                if (photoUrl != null) {
                                    AsyncImage(
                                        model              = photoUrl,
                                        contentDescription = "Maniküre vom ${formatDate(entry.date)}",
                                        contentScale       = ContentScale.Crop,
                                        modifier           = Modifier
                                            .size(48.dp)
                                            .clip(RoundedCornerShape(8.dp)),
                                    )
                                } else {
                                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                        polishes.take(4).forEach { p ->
                                            val c = runCatching { Color(android.graphics.Color.parseColor(p.color)) }.getOrElse { Color(0xFFff6699) }
                                            Box(Modifier.size(20.dp).clip(CircleShape).background(c).semantics { contentDescription = p.name })
                                        }
                                    }
                                }
                            },
                            modifier = Modifier.clickable { editing = entry; showForm = true },
                        )
                    }
                }
            }
        }
    }

    if (showForm) {
        DiaryFormSheet(
            entry = editing,
            availablePolishes = state.polishes,
            photoBaseUrl = state.photoBaseUrl,
            onImportPhoto = vm::importPhoto,
            onSave = { m -> if (editing != null) vm.updateManicure(m) else vm.addManicure(m); showForm = false },
            onDelete = editing?.let { { vm.deleteManicure(it.id); showForm = false } },
            onDismiss = { showForm = false },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun DiaryFormSheet(
    entry: Manicure?,
    availablePolishes: List<Polish>,
    photoBaseUrl: String?,
    onImportPhoto: suspend (Uri) -> String,
    onSave: (Manicure) -> Unit,
    onDelete: (() -> Unit)?,
    onDismiss: () -> Unit,
) {
    val now = System.currentTimeMillis()
    var date by remember(entry) { mutableStateOf(entry?.date ?: todayIso()) }
    var selectedIds by remember(entry) { mutableStateOf(entry?.polishIds ?: emptyList()) }
    var notes by remember(entry) { mutableStateOf(entry?.notes ?: "") }
    var photo by remember(entry) { mutableStateOf(entry?.photo) }
    var showDatePicker by remember { mutableStateOf(false) }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
            Text(if (entry != null) "Eintrag bearbeiten" else "Neuer Eintrag", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(bottom = 16.dp))

            PhotoPickerField(photo = photo, photoBaseUrl = photoBaseUrl, onPhotoChange = { photo = it }, onImportPhoto = onImportPhoto)
            Spacer(Modifier.height(12.dp))

            OutlinedTextField(
                value = formatDate(date),
                onValueChange = {},
                label = { Text("Datum") },
                readOnly = true,
                modifier = Modifier.fillMaxWidth().clickable { showDatePicker = true },
                enabled = false,
            )
            Spacer(Modifier.height(8.dp))

            Text("Lacke", style = MaterialTheme.typography.labelLarge)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                availablePolishes.forEach { p ->
                    FilterChip(
                        selected = selectedIds.contains(p.id),
                        onClick = { selectedIds = if (selectedIds.contains(p.id)) selectedIds - p.id else selectedIds + p.id },
                        label = { Text(p.name) },
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(notes, { notes = it }, label = { Text("Notizen") }, modifier = Modifier.fillMaxWidth(), minLines = 3)
            Spacer(Modifier.height(16.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                if (onDelete != null) TextButton(onClick = onDelete) { Text("Löschen", color = MaterialTheme.colorScheme.error) }
                Spacer(Modifier.weight(1f))
                TextButton(onClick = onDismiss) { Text("Abbrechen") }
                Button(onClick = {
                    onSave(Manicure(id = entry?.id ?: generateId(), date = date, polishIds = selectedIds, notes = notes.trim(), photo = photo, createdAt = entry?.createdAt ?: now, updatedAt = now))
                }) { Text("Speichern") }
            }
            Spacer(Modifier.height(16.dp))
        }
    }

    if (showDatePicker) {
        val pickerState = rememberDatePickerState(initialSelectedDateMillis = runCatching { SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).parse(date)?.time }.getOrNull())
        DatePickerDialog(
            onDismissRequest = { showDatePicker = false },
            confirmButton = {
                TextButton(onClick = {
                    pickerState.selectedDateMillis?.let { date = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date(it)) }
                    showDatePicker = false
                }) { Text("OK") }
            },
        ) { DatePicker(pickerState) }
    }
}

private fun todayIso() = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date())
private fun formatDate(iso: String): String = runCatching {
    val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
    SimpleDateFormat("d. MMMM yyyy", Locale.GERMAN).format(sdf.parse(iso)!!)
}.getOrDefault(iso)
