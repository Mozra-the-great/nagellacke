package de.nagellacke.ui.stats

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import de.nagellacke.data.repo.NagellackeRepository
import de.nagellacke.domain.FINISH_OPTIONS
import de.nagellacke.domain.STATUS_OPTIONS
import de.nagellacke.domain.hexToHue
import de.nagellacke.domain.model.Polish
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

data class StatsUiState(
    val polishes: List<Polish> = emptyList(),
    val stickerCount: Int = 0,
    val manicureCount: Int = 0,
    val loading: Boolean = true,
)

@HiltViewModel
class StatsViewModel @Inject constructor(repo: NagellackeRepository) : ViewModel() {
    val uiState = repo.observeData().map { data ->
        StatsUiState(
            polishes      = data.polishes.filter { it.deletedAt == null },
            stickerCount  = data.stickers.count { it.deletedAt == null },
            manicureCount = data.manicures.count { it.deletedAt == null },
            loading       = false,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), StatsUiState())
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun StatsScreen(vm: StatsViewModel = hiltViewModel()) {
    val state by vm.uiState.collectAsState()
    val active = state.polishes

    Scaffold(topBar = { TopAppBar(title = { Text("Statistik", fontWeight = FontWeight.Bold) }) }) { padding ->
        Column(Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                KpiCard(active.size, "Lacke", MaterialTheme.colorScheme.primary, Modifier.weight(1f))
                KpiCard(state.stickerCount, "Sticker", MaterialTheme.colorScheme.secondary, Modifier.weight(1f))
                KpiCard(state.manicureCount, "Maniküren", MaterialTheme.colorScheme.tertiary, Modifier.weight(1f))
            }

            Spacer(Modifier.height(20.dp))
            Text("Farbpalette", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(8.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                active.sortedBy { hexToHue(it.color) }.forEach { p ->
                    val c = runCatching { Color(android.graphics.Color.parseColor(p.color)) }.getOrElse { Color(0xFFff6699) }
                    Box(Modifier.size(22.dp).clip(CircleShape).background(c).semantics { contentDescription = p.name })
                }
            }

            if (active.isNotEmpty()) {
                Spacer(Modifier.height(20.dp))
                Text("Nach Finish", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(8.dp))
                val byFinish = active.groupingBy { it.finish }.eachCount()
                FINISH_OPTIONS.filter { (byFinish[it] ?: 0) > 0 }.forEach { f ->
                    BarRow("${f.icon} ${f.label}", byFinish[f] ?: 0, active.size, MaterialTheme.colorScheme.primary)
                }

                Spacer(Modifier.height(20.dp))
                Text("Nach Status", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(8.dp))
                val byStatus = active.groupingBy { it.status }.eachCount()
                STATUS_OPTIONS.filter { (byStatus[it] ?: 0) > 0 }.forEach { s ->
                    BarRow(s.label, byStatus[s] ?: 0, active.size, MaterialTheme.colorScheme.secondary)
                }

                val byBrand = active.groupingBy { it.brand.ifBlank { "Unbekannt" } }.eachCount()
                    .entries.sortedByDescending { it.value }.take(8)
                if (byBrand.isNotEmpty()) {
                    Spacer(Modifier.height(20.dp))
                    Text("Top-Marken", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.height(8.dp))
                    byBrand.forEach { (brand, count) -> BarRow(brand, count, active.size, MaterialTheme.colorScheme.tertiary) }
                }

                val topRated = active.filter { (it.rating ?: 0) > 0 }.sortedByDescending { it.rating }.take(5)
                if (topRated.isNotEmpty()) {
                    Spacer(Modifier.height(20.dp))
                    Text("Bestbewertet", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.height(8.dp))
                    topRated.forEach { p ->
                        val c = runCatching { Color(android.graphics.Color.parseColor(p.color)) }.getOrElse { Color(0xFFff6699) }
                        Surface(Modifier.fillMaxWidth().padding(bottom = 8.dp), shape = RoundedCornerShape(14.dp), tonalElevation = 1.dp) {
                            Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                Box(Modifier.size(36.dp).clip(CircleShape).background(c).semantics { contentDescription = p.name })
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(p.name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                                    Text(p.brand, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                                }
                                Text("★".repeat(p.rating ?: 0), color = Color(0xFFf59e0b))
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
        }
    }
}

@Composable
fun KpiCard(num: Int, label: String, color: Color, modifier: Modifier = Modifier) {
    Surface(modifier, shape = RoundedCornerShape(16.dp), tonalElevation = 1.dp) {
        Column(Modifier.padding(14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(num.toString(), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = color)
            Text(label, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
fun BarRow(label: String, value: Int, total: Int, color: Color) {
    val screenWidth = LocalConfiguration.current.screenWidthDp.dp
    val trackWidth = screenWidth - 32.dp - 110.dp - 48.dp
    val fillWidth = if (total > 0) (value.toFloat() / total * trackWidth.value).coerceAtLeast(2f).dp else 0.dp
    Row(Modifier.fillMaxWidth().padding(bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = MaterialTheme.typography.bodySmall, modifier = Modifier.width(110.dp), maxLines = 1)
        Box(Modifier.weight(1f).height(10.dp).clip(RoundedCornerShape(5.dp)).background(MaterialTheme.colorScheme.surfaceVariant)) {
            Box(Modifier.width(fillWidth).height(10.dp).clip(RoundedCornerShape(5.dp)).background(color))
        }
        Spacer(Modifier.width(8.dp))
        Text(value.toString(), style = MaterialTheme.typography.bodySmall, modifier = Modifier.width(24.dp))
    }
}
