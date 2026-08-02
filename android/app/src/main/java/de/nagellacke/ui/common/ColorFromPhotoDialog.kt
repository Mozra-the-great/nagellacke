package de.nagellacke.ui.common

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import de.nagellacke.domain.argbToHex
import de.nagellacke.domain.mapToBitmapPixel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val MAX_DIMENSION = 1200

private suspend fun loadDownsampledBitmap(context: Context, uri: Uri, maxDimension: Int): Bitmap? = withContext(Dispatchers.IO) {
    runCatching {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (bounds.outWidth / sample > maxDimension || bounds.outHeight / sample > maxDimension) sample *= 2
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) }
    }.getOrNull()
}

/**
 * "Farbe aus Foto" — port of ColorFromPhoto.tsx: pick a photo, tap or drag across it to sample a
 * pixel color, apply it as the polish color. The image's layout box is forced to the bitmap's own
 * aspect ratio so ContentScale.Fit fills it exactly with no letterboxing — pointer position within
 * the box then maps to bitmap pixels by simple linear scaling (see [mapToBitmapPixel]).
 */
@Composable
fun ColorFromPhotoDialog(onColorPicked: (String) -> Unit, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var bitmap by remember { mutableStateOf<Bitmap?>(null) }
    var pickedColor by remember { mutableStateOf<String?>(null) }

    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            scope.launch {
                bitmap = loadDownsampledBitmap(context, uri, MAX_DIMENSION)
                pickedColor = null
            }
        }
    }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
            Row(
                Modifier.fillMaxWidth().padding(8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Farbe aus Foto", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 8.dp))
                IconButton(onClick = onDismiss) { Icon(Icons.Default.Close, contentDescription = "Schließen") }
            }

            val currentBitmap = bitmap
            if (currentBitmap == null) {
                Box(
                    Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .padding(24.dp)
                        .clickable { launcher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                    contentAlignment = Alignment.Center,
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("📷", style = MaterialTheme.typography.displayLarge)
                        Spacer(Modifier.padding(4.dp))
                        Text("Foto auswählen", style = MaterialTheme.typography.bodyLarge)
                    }
                }
            } else {
                fun sample(x: Float, y: Float, w: Float, h: Float) {
                    val (px, py) = mapToBitmapPixel(x, y, w, h, currentBitmap.width, currentBitmap.height)
                    pickedColor = argbToHex(currentBitmap.getPixel(px, py))
                }

                Image(
                    bitmap = currentBitmap.asImageBitmap(),
                    contentDescription = "Ausgewähltes Foto",
                    modifier = Modifier
                        .weight(1f, fill = false)
                        .fillMaxWidth()
                        .aspectRatio(currentBitmap.width.toFloat() / currentBitmap.height.toFloat())
                        .pointerInput(currentBitmap) {
                            detectTapGestures { offset -> sample(offset.x, offset.y, size.width.toFloat(), size.height.toFloat()) }
                        }
                        .pointerInput(currentBitmap) {
                            detectDragGestures(
                                onDragStart = { offset -> sample(offset.x, offset.y, size.width.toFloat(), size.height.toFloat()) },
                                onDrag = { change, _ -> change.consume(); sample(change.position.x, change.position.y, size.width.toFloat(), size.height.toFloat()) },
                            )
                        },
                )
            }

            Row(
                Modifier.fillMaxWidth().padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                val color = pickedColor
                if (color != null) {
                    val previewColor = runCatching { Color(android.graphics.Color.parseColor(color)) }.getOrElse { Color(0xFFff6699) }
                    Box(Modifier.size(32.dp).clip(CircleShape).background(previewColor))
                    Text(color, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                    Button(onClick = { onColorPicked(color); onDismiss() }) { Text("Übernehmen") }
                } else {
                    Text(
                        if (currentBitmap != null) "Auf eine Farbe im Foto tippen" else "Foto auswählen, um eine Farbe zu picken",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.outline,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
    }
}
