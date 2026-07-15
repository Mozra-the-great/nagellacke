package de.nagellacke.ui.collection

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
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.unit.dp
import de.nagellacke.domain.FINISH_OPTIONS
import de.nagellacke.domain.STATUS_OPTIONS
import de.nagellacke.domain.generateId
import de.nagellacke.domain.isValidHex
import de.nagellacke.domain.model.Category
import de.nagellacke.domain.model.FinishType
import de.nagellacke.domain.model.Polish
import de.nagellacke.domain.model.PolishStatus
import de.nagellacke.ui.common.PhotoPickerField

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun PolishFormSheet(
    polish: Polish?,
    categories: List<Category>,
    photoBaseUrl: String?,
    onImportPhoto: suspend (Uri) -> String,
    onSave: (Polish) -> Unit,
    onDelete: (() -> Unit)?,
    onDismiss: () -> Unit,
) {
    val now = System.currentTimeMillis()
    var name by remember(polish) { mutableStateOf(polish?.name ?: "") }
    var brand by remember(polish) { mutableStateOf(polish?.brand ?: "") }
    var num by remember(polish) { mutableStateOf(polish?.num ?: "") }
    var color by remember(polish) { mutableStateOf(polish?.color ?: "#ff6699") }
    var finish by remember(polish) { mutableStateOf(polish?.finish ?: FinishType.Classic) }
    var status by remember(polish) { mutableStateOf(polish?.status ?: PolishStatus.Ok) }
    var notes by remember(polish) { mutableStateOf(polish?.notes ?: "") }
    var rating by remember(polish) { mutableStateOf(polish?.rating ?: 0) }
    var selectedCats by remember(polish) { mutableStateOf(polish?.categories ?: emptyList()) }
    var photo by remember(polish) { mutableStateOf(polish?.photo) }

    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, dragHandle = { BottomSheetDefaults.DragHandle() }) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
            Text(
                if (polish != null) "Bearbeiten" else "Neuer Lack",
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.padding(bottom = 16.dp),
            )

            PhotoPickerField(photo = photo, photoBaseUrl = photoBaseUrl, onPhotoChange = { photo = it }, onImportPhoto = onImportPhoto)
            Spacer(Modifier.height(12.dp))

            OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Name *") }, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(value = brand, onValueChange = { brand = it }, label = { Text("Marke") }, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(value = num, onValueChange = { num = it }, label = { Text("Nummer") }, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(8.dp))

            OutlinedTextField(
                value = color,
                onValueChange = { color = it },
                label = { Text("Farbe (Hex)") },
                modifier = Modifier.fillMaxWidth(),
                trailingIcon = {
                    val c = runCatching { Color(android.graphics.Color.parseColor(if (color.startsWith("#")) color else "#$color")) }.getOrElse { Color(0xFFff6699) }
                    Box(Modifier.size(28.dp).clip(CircleShape).background(c).semantics { contentDescription = "Farbvorschau" })
                },
                isError = color.isNotBlank() && !isValidHex(color),
            )
            Spacer(Modifier.height(12.dp))

            Text("Finish", style = MaterialTheme.typography.labelLarge)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                FINISH_OPTIONS.forEach { f ->
                    FilterChip(selected = finish == f, onClick = { finish = f }, label = { Text("${f.icon} ${f.label}") })
                }
            }
            Spacer(Modifier.height(8.dp))

            Text("Status", style = MaterialTheme.typography.labelLarge)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                STATUS_OPTIONS.forEach { s ->
                    FilterChip(selected = status == s, onClick = { status = s }, label = { Text(s.label) })
                }
            }
            Spacer(Modifier.height(8.dp))

            Text("Bewertung", style = MaterialTheme.typography.labelLarge)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                (1..5).forEach { n ->
                    Text(
                        "★", style = MaterialTheme.typography.headlineMedium,
                        color = if (n <= rating) Color(0xFFf59e0b) else MaterialTheme.colorScheme.outlineVariant,
                        modifier = Modifier.clickable { rating = if (rating == n) 0 else n }.semantics { contentDescription = "$n Sterne" },
                    )
                }
            }
            Spacer(Modifier.height(8.dp))

            if (categories.isNotEmpty()) {
                Text("Kategorien", style = MaterialTheme.typography.labelLarge)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    categories.forEach { cat ->
                        FilterChip(
                            selected = selectedCats.contains(cat.id),
                            onClick = { selectedCats = if (selectedCats.contains(cat.id)) selectedCats - cat.id else selectedCats + cat.id },
                            label = { Text(cat.label) },
                        )
                    }
                }
                Spacer(Modifier.height(8.dp))
            }

            OutlinedTextField(value = notes, onValueChange = { notes = it }, label = { Text("Notizen") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
            Spacer(Modifier.height(16.dp))

            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
                if (onDelete != null) TextButton(onClick = onDelete) { Text("Löschen", color = MaterialTheme.colorScheme.error) }
                Spacer(Modifier.weight(1f))
                TextButton(onClick = onDismiss) { Text("Abbrechen") }
                Button(
                    onClick = {
                        onSave(Polish(
                            id = polish?.id ?: generateId(),
                            name = name.trim(), brand = brand.trim(), num = num.trim(),
                            color = if (isValidHex(color)) color else "#ff6699",
                            finish = finish, status = status, notes = notes.trim(),
                            rating = rating, categories = selectedCats,
                            photo = photo,
                            createdAt = polish?.createdAt ?: now, updatedAt = now,
                        ))
                    },
                    enabled = name.isNotBlank(),
                ) { Text("Speichern") }
            }
            Spacer(Modifier.height(16.dp))
        }
    }
}
