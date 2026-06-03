package de.nagellacke.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

private val LightColors = lightColorScheme(
    primary = Color(0xFFc2185b),
    primaryContainer = Color(0xFFffd8ec),
    secondary = Color(0xFF9c27b0),
    secondaryContainer = Color(0xFFf3e5f5),
    surface = Color(0xFFfffbfe),
    background = Color(0xFFfffbfe),
    tertiary = Color(0xFF2e7d32),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFFf48fb1),
    primaryContainer = Color(0xFF880e4f),
    secondary = Color(0xFFce93d8),
    secondaryContainer = Color(0xFF4a148c),
    surface = Color(0xFF141218),
    background = Color(0xFF141218),
    tertiary = Color(0xFF81c784),
)

@Composable
fun NagellackeTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colors = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val ctx = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(ctx) else dynamicLightColorScheme(ctx)
        }
        darkTheme -> DarkColors
        else      -> LightColors
    }
    MaterialTheme(colorScheme = colors, content = content)
}
