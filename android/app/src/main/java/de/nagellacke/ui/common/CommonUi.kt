package de.nagellacke.ui.common

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import de.nagellacke.ui.collection.PhotoResolution
import kotlinx.coroutines.launch

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

/**
 * Single-photo picker used by the polish and sticker edit forms.
 *
 * Launches the Android photo picker (no runtime permission needed), imports the picked
 * image via [importPhoto] (which downsamples/compresses it and returns a local filename),
 * and previews it via [resolvePhotoUri] — the freshly imported photo is a local file that
 * has not been uploaded yet, so the preview must use the local URI, not a server URL.
 */
@Composable
fun PhotoPickerField(
    photo: String?,
    resolvePhotoUri: (String) -> Uri,
    importPhoto: suspend (Uri) -> String,
    onPhotoChange: (String?) -> Unit,
    modifier: Modifier = Modifier,
    label: String = "Foto",
) {
    val scope = rememberCoroutineScope()
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            scope.launch { onPhotoChange(importPhoto(uri)) }
        }
    }

    Column(modifier) {
        Text(label, style = MaterialTheme.typography.labelLarge)
        Spacer(Modifier.height(6.dp))
        if (photo != null) {
            Box(Modifier.size(96.dp)) {
                AsyncImage(
                    model = resolvePhotoUri(photo),
                    contentDescription = label,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize().clip(RoundedCornerShape(12.dp)),
                )
                Box(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(4.dp)
                        .size(24.dp)
                        .background(Color.Black.copy(alpha = 0.55f), CircleShape)
                        .clickable { onPhotoChange(null) }
                        .semantics { contentDescription = "Foto entfernen" },
                    contentAlignment = Alignment.Center,
                ) {
                    Text("✕", color = Color.White, style = MaterialTheme.typography.labelSmall)
                }
            }
        } else {
            OutlinedButton(onClick = { launcher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }) {
                Text("Foto auswählen")
            }
        }
    }
}

/**
 * Multi-photo picker used by the diary form — a manicure can have several photo slots
 * (the web app supports fingers/thumbs of both hands), stored as a flat filename list.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PhotoListPickerField(
    photos: List<String>,
    resolvePhotoUri: (String) -> Uri,
    importPhoto: suspend (Uri) -> String,
    onPhotosChange: (List<String>) -> Unit,
    modifier: Modifier = Modifier,
    label: String = "Fotos",
) {
    val scope = rememberCoroutineScope()
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            scope.launch {
                val filename = importPhoto(uri)
                onPhotosChange(photos + filename)
            }
        }
    }

    Column(modifier) {
        Text(label, style = MaterialTheme.typography.labelLarge)
        Spacer(Modifier.height(6.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            photos.forEach { filename ->
                Box(Modifier.size(72.dp)) {
                    AsyncImage(
                        model = resolvePhotoUri(filename),
                        contentDescription = label,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize().clip(RoundedCornerShape(10.dp)),
                    )
                    Box(
                        modifier = Modifier
                            .align(Alignment.TopEnd)
                            .padding(2.dp)
                            .size(20.dp)
                            .background(Color.Black.copy(alpha = 0.55f), CircleShape)
                            .clickable { onPhotosChange(photos - filename) }
                            .semantics { contentDescription = "Foto entfernen" },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("✕", color = Color.White, style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
            OutlinedButton(onClick = { launcher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }) {
                Text("+ Foto")
            }
        }
    }
}
