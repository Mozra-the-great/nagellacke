package de.nagellacke.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import coil.request.ImageRequest
import de.nagellacke.ui.collection.PhotoResolution

@Composable
fun LoadingScreen() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
    }
}

@Composable
fun EmptyScreen(message: String, emoji: String = "✨") {
    Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(emoji, style = MaterialTheme.typography.displayLarge)
            Spacer(Modifier.height(16.dp))
            Text(
                message,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
fun ErrorScreen(message: String) {
    Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
        Text(
            "⚠ $message",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.error,
            textAlign = TextAlign.Center,
        )
    }
}

/**
 * Builds a Coil-loadable model for [filename] given the current [PhotoResolution], attaching an
 * `Authorization` header when the provider requires one. Returns null when there is no photo or
 * the provider cannot resolve it (see [UnsupportedPhotoIndicator] for that case).
 */
@Composable
fun rememberPhotoModel(resolution: PhotoResolution, filename: String?): Any? {
    val resolvable = resolution as? PhotoResolution.Resolvable ?: return null
    if (filename == null) return null
    val context = LocalContext.current
    return remember(filename, resolvable) {
        ImageRequest.Builder(context)
            .data(resolvable.urlFor(filename))
            .apply { resolvable.authHeader?.let { setHeader("Authorization", it) } }
            .build()
    }
}

/** Small badge shown instead of a photo when the sync provider can't serve it yet (e.g. Google Drive). */
@Composable
fun UnsupportedPhotoIndicator(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .background(Color.Black.copy(alpha = 0.45f))
            .semantics { contentDescription = "Fotos werden von diesem Sync-Anbieter nicht unterstützt" },
        contentAlignment = Alignment.Center,
    ) {
        Text("🚫", style = MaterialTheme.typography.labelSmall, color = Color.White)
    }
}
