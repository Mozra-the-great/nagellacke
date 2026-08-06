package de.nagellacke.ui.wishlist

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import coil.compose.AsyncImage
import de.nagellacke.domain.model.Polish
import de.nagellacke.domain.model.PolishStatus
import de.nagellacke.ui.collection.PhotoResolution
import de.nagellacke.ui.collection.PolishCard
import de.nagellacke.ui.collection.PolishFormSheet
import de.nagellacke.ui.common.EmptyScreen
import de.nagellacke.ui.common.LoadingScreen
import de.nagellacke.ui.common.NailBottle
import de.nagellacke.ui.common.rememberPhotoModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WishlistScreen(vm: WishlistViewModel = hiltViewModel()) {
    val state by vm.uiState.collectAsState()
    val smartCartStatus by vm.smartCartStatus.collectAsState()
    var viewing by remember { mutableStateOf<Polish?>(null) }
    var showForm by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<Polish?>(null) }
    var smartCartPrompt by remember { mutableStateOf("") }

    LaunchedEffect(smartCartStatus) {
        if (smartCartStatus is SmartCartStatus.Done) smartCartPrompt = ""
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text("Wunschliste", fontWeight = FontWeight.Bold) }) },
        floatingActionButton = {
            FloatingActionButton(
                onClick = { editing = null; showForm = true },
                containerColor = MaterialTheme.colorScheme.primary,
            ) {
                Icon(Icons.Default.Add, contentDescription = "Zur Wunschliste hinzufügen")
            }
        }
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            if (state.aiAvailable) {
                Card(Modifier.fillMaxWidth().padding(16.dp)) {
                    Column(Modifier.padding(12.dp)) {
                        Text("✨ Smart-Cart", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                        Text(
                            "Beschreibe, was dir fehlt — z. B. „Catrice-Lacke ohne Shimmer, um den Regenbogen zu vervollständigen\".",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.outline,
                            modifier = Modifier.padding(top = 2.dp, bottom = 8.dp),
                        )
                        OutlinedTextField(
                            value = smartCartPrompt,
                            onValueChange = { smartCartPrompt = it },
                            placeholder = { Text("Was möchtest du hinzufügen?") },
                            modifier = Modifier.fillMaxWidth(),
                            minLines = 2,
                            enabled = smartCartStatus !is SmartCartStatus.Running,
                        )
                        when (val status = smartCartStatus) {
                            is SmartCartStatus.Error -> Text(status.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 4.dp))
                            is SmartCartStatus.Done -> Text(
                                if (status.added > 0) "✨ ${status.added} zur Wunschliste hinzugefügt" else "Keine passenden, real existierenden Produkte gefunden",
                                color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 4.dp),
                            )
                            else -> {}
                        }
                        Spacer(Modifier.height(8.dp))
                        Button(
                            onClick = { vm.runSmartCart(smartCartPrompt) },
                            enabled = smartCartPrompt.isNotBlank() && smartCartStatus !is SmartCartStatus.Running,
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text(if (smartCartStatus is SmartCartStatus.Running) "KI recherchiert…" else "✨ Vorschläge finden") }
                    }
                }
            }

            Text(
                "${state.polishes.size} auf der Wunschliste",
                style    = MaterialTheme.typography.bodySmall,
                color    = MaterialTheme.colorScheme.outline,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )

            when {
                state.loading           -> LoadingScreen()
                state.polishes.isEmpty() -> EmptyScreen("Noch nichts auf der Wunschliste.\nTippe + um einen Lack hinzuzufügen.", "🛒")
                else -> LazyVerticalGrid(
                    columns              = GridCells.Fixed(2),
                    contentPadding       = PaddingValues(12.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalArrangement  = Arrangement.spacedBy(10.dp),
                    modifier             = Modifier.weight(1f),
                ) {
                    items(state.polishes, key = { it.id }) { polish ->
                        PolishCard(
                            polish          = polish,
                            bottleStyle     = state.bottleStyle,
                            photoResolution = state.photoResolution,
                            onClick         = { viewing = it },
                        )
                    }
                }
            }
        }
    }

    viewing?.let { polish ->
        WishlistDetailSheet(
            polish = polish,
            photoResolution = state.photoResolution,
            onDismiss = { viewing = null },
            onEdit = { viewing = null; editing = polish; showForm = true },
            onMarkBought = { vm.markBought(polish); viewing = null },
        )
    }

    if (showForm) {
        PolishFormSheet(
            polish     = editing,
            categories = state.categories,
            initialStatus = PolishStatus.Wish,
            aiAvailable = state.aiAvailable,
            onSave     = { p, autofill -> if (editing != null) vm.updatePolish(p) else vm.addPolish(p, autofill); showForm = false },
            onDelete   = editing?.let { { vm.deletePolish(it.id); showForm = false } },
            onDismiss  = { showForm = false },
            resolvePhotoUri = vm::resolvePhotoUri,
            photoExistsLocally = vm::photoExistsLocally,
            photoResolution = state.photoResolution,
            importPhoto     = vm::importPhoto,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun WishlistDetailSheet(
    polish: Polish,
    photoResolution: PhotoResolution,
    onDismiss: () -> Unit,
    onEdit: () -> Unit,
    onMarkBought: () -> Unit,
) {
    val photoModel = rememberPhotoModel(photoResolution, polish.photo)

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
            if (photoModel != null) {
                AsyncImage(
                    model = photoModel,
                    contentDescription = polish.name,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxWidth().height(220.dp).clip(RoundedCornerShape(12.dp)),
                )
            } else {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                    NailBottle(polish = polish, modifier = Modifier.height(160.dp))
                }
            }
            Spacer(Modifier.height(12.dp))
            Text(polish.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            if (polish.brand.isNotBlank()) {
                Text(polish.brand, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.outline)
            }
            if (polish.num.isNotBlank()) {
                Spacer(Modifier.height(4.dp))
                Text("Nummer: ${polish.num}", style = MaterialTheme.typography.bodySmall)
            }
            Spacer(Modifier.height(4.dp))
            Text("${polish.finish.icon} ${polish.finish.label}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
            if (polish.notes.isNotBlank()) {
                Spacer(Modifier.height(8.dp))
                Text(polish.notes, style = MaterialTheme.typography.bodyMedium)
            }
            Spacer(Modifier.height(16.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onDismiss) { Text("Schließen") }
                Spacer(Modifier.weight(1f))
                TextButton(onClick = onEdit) { Text("Bearbeiten") }
                Button(onClick = onMarkBought) { Text("Gekauft ✓") }
            }
            Spacer(Modifier.height(16.dp))
        }
    }
}
