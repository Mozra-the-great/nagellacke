package de.nagellacke.ui.common

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
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
 * Photo picker used by the polish/sticker/manicure edit forms. Launches the system photo picker
 * (no runtime permission needed), imports the picked image via [onImportPhoto] (which also
 * uploads it to the configured sync provider when one exists), and reports the resulting
 * filename — or `null` on removal — via [onPhotoChange].
 */
@Composable
fun PhotoPickerField(
    photo: String?,
    photoBaseUrl: String?,
    onPhotoChange: (String?) -> Unit,
    onImportPhoto: suspend (Uri) -> String,
) {
    var localPreviewUri by remember { mutableStateOf<Uri?>(null) }
    var uploading by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    val pickMedia = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            localPreviewUri = uri
            uploading = true
            scope.launch {
                val filename = onImportPhoto(uri)
                uploading = false
                onPhotoChange(filename)
            }
        }
    }
    val hasPhoto = photo != null || localPreviewUri != null

    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier
                .size(72.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .clickable { pickMedia.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
            contentAlignment = Alignment.Center,
        ) {
            when {
                localPreviewUri != null -> AsyncImage(
                    model = localPreviewUri,
                    contentDescription = "Foto",
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
                photo != null && photoBaseUrl != null -> AsyncImage(
                    model = "$photoBaseUrl$photo",
                    contentDescription = "Foto",
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
                else -> Text("📷", style = MaterialTheme.typography.headlineMedium)
            }
            if (uploading) CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
        }
        Spacer(Modifier.width(12.dp))
        Column {
            TextButton(onClick = { pickMedia.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }) {
                Text(if (hasPhoto) "Foto ändern" else "Foto hinzufügen")
            }
            if (hasPhoto) {
                TextButton(onClick = { localPreviewUri = null; onPhotoChange(null) }) {
                    Text("Entfernen", color = MaterialTheme.colorScheme.error)
                }
            }
        }
    }
}
