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
import androidx.compose.foundation.layout.fillMaxHeight
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
import androidx.compose.material.icons.filled.ImageNotSupported
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import coil.compose.AsyncImage
import de.nagellacke.domain.STATUS_OPTIONS
import de.nagellacke.domain.model.Polish
import de.nagellacke.ui.common.EmptyScreen
import de.nagellacke.ui.common.LoadingScreen
import de.nagellacke.ui.common.NailBottle

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CollectionScreen(vm: CollectionViewModel = hiltViewModel()) {
    val state by vm.uiState.collectAsState()
    var showForm by remember { mutableStateOf(false) }
    var editing  by remember { mutableStateOf<Polish?>(null) }

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
                        onClick  = { vm.setStatus(if (state.filter.status == opt) null else opt) },
                        label    = { Text(opt.label) },
                    )
                }
            }

            Text(
                "${state.polishes.size} Lacke",
                style    = MaterialTheme.typography.bodySmall,
                color    = MaterialTheme.colorScheme.outline,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )

            when {
                state.loading          -> LoadingScreen()
                state.polishes.isEmpty() -> EmptyScreen("Noch keine Lacke.\nTippe + um den ersten hinzuzufügen.", "💅")
                else -> LazyVerticalGrid(
                    columns              = GridCells.Fixed(2),
                    contentPadding       = PaddingValues(12.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalArrangement  = Arrangement.spacedBy(10.dp),
                    modifier             = Modifier.weight(1f),
                ) {
                    items(state.polishes, key = { it.id }) { polish ->
                        PolishCard(
                            polish            = polish,
                            bottleStyle       = state.bottleStyle,
                            photoBaseUrl      = state.photoBaseUrl,
                            photosUnsupported = state.photosUnsupported,
                            onClick           = { editing = it; showForm = true },
                        )
                    }
                }
            }
        }
    }

    if (showForm) {
        PolishFormSheet(
            polish     = editing,
            categories = state.categories,
            onSave     = { p -> if (editing != null) vm.updatePolish(p) else vm.addPolish(p); showForm = false },
            onDelete   = editing?.let { { vm.deletePolish(it.id); showForm = false } },
            onDismiss  = { showForm = false },
        )
    }
}

/**
 * Card that displays a single nail polish.
 *
 * Visual priority (top → bottom):
 *   1. Photo (via Coil AsyncImage) — shown by default when available
 *   2. Nail-bottle SVG (NailBottle composable) — when [bottleStyle] = true
 *   3. Plain colour swatch — fallback / user preference
 *
 * A small toggle button (📷 / ◎) appears on photo-capable cards so the user can
 * switch between photo and icon view per card without affecting the global setting.
 */
@Composable
fun PolishCard(
    polish: Polish,
    bottleStyle: Boolean,
    photoBaseUrl: String?,
    photosUnsupported: Boolean = false,
    onClick: (Polish) -> Unit,
) {
    val hasPhoto = polish.photo != null && photoBaseUrl != null
    val photoUnavailable = polish.photo != null && !hasPhoto && photosUnsupported
    var showPhoto by remember(polish.id) { mutableStateOf(hasPhoto) }

    val color = runCatching {
        Color(android.graphics.Color.parseColor(polish.color))
    }.getOrElse { Color(0xFFff6699) }

    Card(
        modifier = Modifier.fillMaxWidth().clickable { onClick(polish) },
        shape    = RoundedCornerShape(16.dp),
    ) {
        // ── Visual area ──────────────────────────────────────────────────────
        Box(
            modifier = Modifier.fillMaxWidth().aspectRatio(0.75f)
        ) {
            when {
                // 1. Photo view
                hasPhoto && showPhoto -> AsyncImage(
                    model            = "$photoBaseUrl${polish.photo}",
                    contentDescription = polish.name,
                    contentScale     = ContentScale.Crop,
                    modifier         = Modifier.fillMaxSize(),
                )

                // 2. Bottle SVG
                bottleStyle -> Box(
                    modifier           = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceVariant),
                    contentAlignment   = Alignment.Center,
                ) {
                    NailBottle(
                        polish   = polish,
                        modifier = Modifier.fillMaxHeight(0.92f),
                    )
                }

                // 3. Plain colour swatch
                else -> Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(color)
                        .semantics { contentDescription = "Farbvorschau ${polish.color}" }
                )
            }

            // Count badge (top-left)
            if (polish.count > 1) {
                Box(
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(6.dp)
                        .background(
                            color = MaterialTheme.colorScheme.primaryContainer,
                            shape = RoundedCornerShape(6.dp),
                        )
                        .padding(horizontal = 5.dp, vertical = 2.dp),
                ) {
                    Text(
                        text  = "${polish.count}×",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onPrimaryContainer,
                    )
                }
            }

            // Photo toggle button (top-right) — only visible when a photo exists
            if (hasPhoto) {
                Box(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(6.dp)
                        .size(28.dp)
                        .background(Color.Black.copy(alpha = 0.45f), CircleShape)
                        .clip(CircleShape)
                        .clickable { showPhoto = !showPhoto }
                        .semantics {
                            contentDescription = if (showPhoto) "Flasche anzeigen" else "Foto anzeigen"
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text  = if (showPhoto) "◎" else "📷",
                        style = MaterialTheme.typography.labelSmall,
                        color = Color.White,
                    )
                }
            }

            // Photo-unavailable indicator (top-right) — a photo exists but the current
            // sync provider doesn't support displaying it (see issue #90)
            if (photoUnavailable) {
                Box(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(6.dp)
                        .size(28.dp)
                        .background(Color.Black.copy(alpha = 0.45f), CircleShape)
                        .clip(CircleShape)
                        .semantics {
                            contentDescription = "Foto vorhanden, aber mit diesem Sync-Anbieter nicht anzeigbar"
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = Icons.Default.ImageNotSupported,
                        contentDescription = null,
                        tint     = Color.White,
                        modifier = Modifier.size(16.dp),
                    )
                }
            }
        }

        // ── Text info ─────────────────────────────────────────────────────────
        Column(Modifier.padding(10.dp)) {
            Text(
                polish.name,
                style      = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines   = 1,
            )
            if (polish.brand.isNotBlank()) {
                Text(
                    polish.brand,
                    style    = MaterialTheme.typography.bodySmall,
                    color    = MaterialTheme.colorScheme.outline,
                    maxLines = 1,
                )
            }
            Text(
                polish.finish.label,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.primary,
            )
        }
    }
}
