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
import de.nagellacke.domain.model.ManicurePhotos
import de.nagellacke.domain.model.Polish
import de.nagellacke.domain.model.PolishRef
import de.nagellacke.domain.model.Sticker
import de.nagellacke.domain.model.StickerRef
import de.nagellacke.domain.model.toFlatList
import de.nagellacke.ui.collection.PhotoResolution
import de.nagellacke.ui.common.EmptyScreen
import de.nagellacke.ui.common.LoadingScreen
import de.nagellacke.ui.common.PhotoPickerField
import de.nagellacke.ui.common.UnsupportedPhotoIndicator
import de.nagellacke.ui.common.rememberPhotoModel
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

private data class PhotoSlot(
    val label: String,
    val get: (ManicurePhotos) -> String?,
    val set: (ManicurePhotos, String?) -> ManicurePhotos,
)

/** Mirrors the web app's PHOTO_SLOTS (DiaryPage.tsx): finger before thumb, right before left. */
private val PHOTO_SLOTS = listOf(
    PhotoSlot("Finger rechts", { it.fingerRight }, { p, v -> p.copy(fingerRight = v) }),
    PhotoSlot("Finger links", { it.fingerLeft }, { p, v -> p.copy(fingerLeft = v) }),
    PhotoSlot("Daumen rechts", { it.thumbRight }, { p, v -> p.copy(thumbRight = v) }),
    PhotoSlot("Daumen links", { it.thumbLeft }, { p, v -> p.copy(thumbLeft = v) }),
)

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
                        val photoName = entry.photos.toFlatList().firstOrNull() ?: entry.photo
                        val photoModel = rememberPhotoModel(state.photoResolution, photoName)
                        val photoUnsupported = photoName != null && state.photoResolution is PhotoResolution.Unsupported
                        val fallbackText = (polishes.map { it.name } + entry.stickerRefs.map { it.name }).joinToString(", ").take(60)
                        ListItem(
                            headlineContent   = { Text(formatDate(entry.date), color = MaterialTheme.colorScheme.primary) },
                            supportingContent = { Text(entry.notes.ifBlank { fallbackText }) },
                            leadingContent    = {
                                when {
                                    photoModel != null -> AsyncImage(
                                        model              = photoModel,
                                        contentDescription = "Maniküre vom ${formatDate(entry.date)}",
                                        contentScale       = ContentScale.Crop,
                                        modifier           = Modifier
                                            .size(48.dp)
                                            .clip(RoundedCornerShape(8.dp)),
                                    )
                                    photoUnsupported -> UnsupportedPhotoIndicator(
                                        modifier = Modifier.size(48.dp).clip(RoundedCornerShape(8.dp)),
                                    )
                                    else -> Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
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
            availableStickers = state.stickers,
            onSave = { m -> if (editing != null) vm.updateManicure(m) else vm.addManicure(m); showForm = false },
            onDelete = editing?.let { { vm.deleteManicure(it.id); showForm = false } },
            onDismiss = { showForm = false },
            resolvePhotoUri = vm::resolvePhotoUri,
            importPhoto = vm::importPhoto,
        )
    }
}

/** Resolves an entry's sticker refs, falling back to matching legacy `stickers` (ids/names) against [available]. */
internal fun resolveStickerRefs(entry: Manicure?, available: List<Sticker>): List<StickerRef> {
    if (entry == null) return emptyList()
    if (entry.stickerRefs.isNotEmpty()) return entry.stickerRefs
    return entry.stickers.mapNotNull { idOrName -> available.find { it.id == idOrName || it.name == idOrName } }
        .map { StickerRef(id = it.id, name = it.name, colors = it.colors) }
}

/** Builds fresh polish refs from the current selection, mirroring what the web app sends on save. */
internal fun buildPolishRefs(selectedIds: List<String>, available: List<Polish>): List<PolishRef> =
    selectedIds.mapNotNull { id -> available.find { it.id == id } }
        .map { PolishRef(name = it.name, brand = it.brand, color = it.color) }

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun DiaryFormSheet(
    entry: Manicure?,
    availablePolishes: List<Polish>,
    availableStickers: List<Sticker>,
    onSave: (Manicure) -> Unit,
    onDelete: (() -> Unit)?,
    onDismiss: () -> Unit,
    resolvePhotoUri: (String) -> Uri,
    importPhoto: suspend (Uri) -> String,
) {
    val now = System.currentTimeMillis()
    var date by remember(entry) { mutableStateOf(entry?.date ?: todayIso()) }
    var selectedIds by remember(entry) { mutableStateOf(entry?.polishIds ?: emptyList()) }
    var stickerRefs by remember(entry) { mutableStateOf(resolveStickerRefs(entry, availableStickers)) }
    var notes by remember(entry) { mutableStateOf(entry?.notes ?: "") }
    var photos by remember(entry) { mutableStateOf(entry?.photos ?: ManicurePhotos()) }
    var showDatePicker by remember { mutableStateOf(false) }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
            Text(if (entry != null) "Eintrag bearbeiten" else "Neuer Eintrag", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(bottom = 16.dp))

            OutlinedTextField(
                value = formatDate(date),
                onValueChange = {},
                label = { Text("Datum") },
                readOnly = true,
                modifier = Modifier.fillMaxWidth().clickable { showDatePicker = true },
                enabled = false,
            )
            Spacer(Modifier.height(8.dp))

            Text("Fotos", style = MaterialTheme.typography.labelLarge)
            Spacer(Modifier.height(6.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                PHOTO_SLOTS.forEach { slot ->
                    PhotoPickerField(
                        photo = slot.get(photos),
                        resolvePhotoUri = resolvePhotoUri,
                        importPhoto = importPhoto,
                        onPhotoChange = { photos = slot.set(photos, it) },
                        label = slot.label,
                    )
                }
            }
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

            if (availableStickers.isNotEmpty()) {
                Text("Sticker", style = MaterialTheme.typography.labelLarge)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    availableStickers.forEach { s ->
                        val selected = stickerRefs.any { it.id == s.id }
                        FilterChip(
                            selected = selected,
                            onClick = {
                                stickerRefs = if (selected) stickerRefs.filter { it.id != s.id }
                                else stickerRefs + StickerRef(id = s.id, name = s.name, colors = s.colors)
                            },
                            label = { Text(s.name) },
                        )
                    }
                }
                Spacer(Modifier.height(8.dp))
            }

            OutlinedTextField(notes, { notes = it }, label = { Text("Notizen") }, modifier = Modifier.fillMaxWidth(), minLines = 3)
            Spacer(Modifier.height(16.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                if (onDelete != null) TextButton(onClick = onDelete) { Text("Löschen", color = MaterialTheme.colorScheme.error) }
                Spacer(Modifier.weight(1f))
                TextButton(onClick = onDismiss) { Text("Abbrechen") }
                Button(onClick = {
                    val polishRefs = buildPolishRefs(selectedIds, availablePolishes)
                    val result = entry?.copy(
                        date = date, polishIds = selectedIds, polishRefs = polishRefs, notes = notes.trim(),
                        stickers = stickerRefs.map { it.id }, stickerRefs = stickerRefs, photos = photos, updatedAt = now,
                    ) ?: Manicure(
                        id = generateId(), date = date, polishIds = selectedIds, polishRefs = polishRefs, notes = notes.trim(),
                        stickers = stickerRefs.map { it.id }, stickerRefs = stickerRefs, photos = photos, createdAt = now, updatedAt = now,
                    )
                    onSave(result)
                }) { Text("Speichern") }
            }
            Spacer(Modifier.height(16.dp))
        }
    }

    if (showDatePicker) {
        val pickerState = rememberDatePickerState(initialSelectedDateMillis = runCatching { LocalDate.parse(date).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli() }.getOrNull())
        DatePickerDialog(
            onDismissRequest = { showDatePicker = false },
            confirmButton = {
                TextButton(onClick = {
                    pickerState.selectedDateMillis?.let { date = Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString() }
                    showDatePicker = false
                }) { Text("OK") }
            },
        ) { DatePicker(pickerState) }
    }
}

private fun todayIso() = LocalDate.now().toString()
private val displayDateFormatter = DateTimeFormatter.ofPattern("d. MMMM yyyy", Locale.GERMAN)
private fun formatDate(iso: String): String = runCatching {
    displayDateFormatter.format(LocalDate.parse(iso))
}.getOrDefault(iso)
