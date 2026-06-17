package de.nagellacke.ui.common

import android.graphics.Paint as NativePaint
import android.graphics.Typeface
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import de.nagellacke.domain.SHIMMER_FINISHES
import de.nagellacke.domain.model.Polish
import de.nagellacke.domain.model.PolishStatus

/**
 * Compose port of v3/apps/web/src/components/NailBottle.tsx.
 *
 * Renders a stylised nail-polish bottle with a 64:130 (width:height) aspect ratio
 * enforced via [Modifier.aspectRatio]. The caller controls size via [modifier]
 * (e.g. `Modifier.fillMaxHeight(0.9f)` or `Modifier.size(64.dp, 130.dp)`).
 *
 * Status effects:
 *   - empty / gone → 38 % opacity
 *   - wish         → 62 % opacity + ☆ marker
 *   - empty        → additional dark overlay over the lower body (web parity)
 *
 * Shimmer finishes (Shimmer, Glitter, Metallic, Chrome, Holographic, Duochrome) use a
 * multi-stop white/colour gradient instead of the plain colour gradient.
 */
@Composable
fun NailBottle(polish: Polish, modifier: Modifier = Modifier) {
    val bodyColor = runCatching {
        Color(android.graphics.Color.parseColor(polish.color))
    }.getOrElse { Color(0xFFff6699) }

    val isShimmer    = SHIMMER_FINISHES.contains(polish.finish)
    val faded        = polish.status == PolishStatus.Empty || polish.status == PolishStatus.Gone
    val isWish       = polish.status == PolishStatus.Wish
    val overallAlpha = when {
        faded  -> 0.38f
        isWish -> 0.62f
        else   -> 1.00f
    }

    val brandLabel = polish.brand.uppercase().take(9)

    Canvas(
        // aspectRatio tries width-first; if computed height exceeds constraints it falls back
        // to height-first — so both fillMaxWidth and fillMaxHeight callers work correctly.
        modifier = modifier
            .aspectRatio(64f / 130f)
            .graphicsLayer(alpha = overallAlpha),
    ) {
        // Scale factor — maps SVG coordinates (0..64, 0..130) to canvas pixels.
        val sx = size.width  / 64f
        val sy = size.height / 130f

        // ── Cap ─────────────────────────────────────────────────────────────
        drawRoundRect(
            color = Color(0xFF1a1a1a),
            topLeft = Offset(18f * sx, 2f * sy),
            size = Size(28f * sx, 28f * sy),
            cornerRadius = CornerRadius(5f * sx, 5f * sy),
        )
        drawRoundRect(
            color = Color(0xFF2a2a2a),
            topLeft = Offset(20f * sx, 4f * sy),
            size = Size(24f * sx, 24f * sy),
            cornerRadius = CornerRadius(4f * sx, 4f * sy),
        )
        drawRoundRect(
            color = Color.White.copy(alpha = 0.07f),
            topLeft = Offset(22f * sx, 5f * sy),
            size = Size(8f * sx, 22f * sy),
            cornerRadius = CornerRadius(2f * sx, 2f * sy),
        )

        // ── Neck ─────────────────────────────────────────────────────────────
        drawRect(
            color = Color(0xFF1a1a1a),
            topLeft = Offset(26f * sx, 30f * sy),
            size = Size(12f * sx, 12f * sy),
        )
        drawRect(
            color = Color.White.copy(alpha = 0.04f),
            topLeft = Offset(27f * sx, 30f * sy),
            size = Size(5f * sx, 12f * sy),
        )

        // ── Wish marker (between neck and body) ──────────────────────────────
        if (isWish) {
            drawIntoCanvas { canvas ->
                val paint = NativePaint().apply {
                    color = android.graphics.Color.argb(229, 200, 180, 255) // rgba(200,180,255,0.9)
                    textSize = 10f * sy
                    textAlign = NativePaint.Align.CENTER
                    isAntiAlias = true
                }
                canvas.nativeCanvas.drawText("☆", 32f * sx, 39f * sy, paint)
            }
        }

        // ── Body ─────────────────────────────────────────────────────────────
        val bodyStart = Offset(10f * sx, 42f * sy)
        val bodyEnd   = Offset(54f * sx, 124f * sy)

        val bodyBrush: Brush = if (isShimmer) {
            Brush.linearGradient(
                colorStops = arrayOf(
                    0.00f to Color.White.copy(alpha = 0.55f),
                    0.25f to bodyColor,
                    0.50f to Color.White.copy(alpha = 0.35f),
                    0.75f to bodyColor,
                    1.00f to Color.White.copy(alpha = 0.50f),
                ),
                start = bodyStart,
                end   = bodyEnd,
            )
        } else {
            Brush.linearGradient(
                colors = listOf(
                    bodyColor,
                    bodyColor.copy(alpha = 0.85f),
                    Color.Black.copy(alpha = 0.30f),
                ),
                start = bodyStart,
                end   = bodyEnd,
            )
        }

        drawRoundRect(
            brush = bodyBrush,
            topLeft = Offset(10f * sx, 42f * sy),
            size = Size(44f * sx, 82f * sy),
            cornerRadius = CornerRadius(6f * sx, 6f * sy),
        )

        // Sheen overlay (horizontal left-to-right white fade)
        drawRoundRect(
            brush = Brush.horizontalGradient(
                colors = listOf(
                    Color.White.copy(alpha = 0.35f),
                    Color.White.copy(alpha = 0.07f),
                    Color.Transparent,
                ),
                startX = 10f * sx,
                endX   = 54f * sx,
            ),
            topLeft = Offset(10f * sx, 42f * sy),
            size = Size(44f * sx, 82f * sy),
            cornerRadius = CornerRadius(6f * sx, 6f * sy),
        )

        // Lower-body dark overlay — matches web: drawn for 'empty' only
        // (the 38 % overall alpha already signals 'gone' without a second overlay)
        if (polish.status == PolishStatus.Empty) {
            drawRect(
                color = Color.Black.copy(alpha = 0.55f),
                topLeft = Offset(10f * sx, 90f * sy),
                size = Size(44f * sx, 34f * sy),
            )
        }

        // ── Left specular highlights ──────────────────────────────────────────
        drawRoundRect(
            color = Color.White.copy(alpha = 0.17f),
            topLeft = Offset(15f * sx, 48f * sy),
            size = Size(10f * sx, 40f * sy),
            cornerRadius = CornerRadius(3f * sx, 3f * sy),
        )
        drawRoundRect(
            color = Color.White.copy(alpha = 0.24f),
            topLeft = Offset(16f * sx, 49f * sy),
            size = Size(4f * sx, 20f * sy),
            cornerRadius = CornerRadius(2f * sx, 2f * sy),
        )

        // ── Bottom band ───────────────────────────────────────────────────────
        drawRoundRect(
            color = Color.Black.copy(alpha = 0.20f),
            topLeft = Offset(10f * sx, 108f * sy),
            size = Size(44f * sx, 16f * sy),
            cornerRadius = CornerRadius(6f * sx, 6f * sy),
        )

        // ── Label background ──────────────────────────────────────────────────
        drawRoundRect(
            color = Color.White.copy(alpha = 0.11f),
            topLeft = Offset(18f * sx, 75f * sy),
            size = Size(28f * sx, 30f * sy),
            cornerRadius = CornerRadius(2f * sx, 2f * sy),
        )

        // ── Label text & separator ────────────────────────────────────────────
        drawIntoCanvas { canvas ->
            val brandFontSize = if (brandLabel.length > 6) 3f * sy else 4f * sy

            val brandPaint = NativePaint().apply {
                color       = android.graphics.Color.argb(166, 255, 255, 255) // white 65 %
                textSize    = brandFontSize
                textAlign   = NativePaint.Align.CENTER
                isAntiAlias = true
                typeface    = Typeface.SERIF
                letterSpacing = 0.08f
            }
            canvas.nativeCanvas.drawText(brandLabel, 32f * sx, 87f * sy, brandPaint)

            val linePaint = NativePaint().apply {
                color       = android.graphics.Color.argb(64, 255, 255, 255) // white 25 %
                strokeWidth = 0.5f * sy
                isAntiAlias = true
            }
            canvas.nativeCanvas.drawLine(20f * sx, 90f * sy, 44f * sx, 90f * sy, linePaint)

            val subPaint = NativePaint().apply {
                color       = android.graphics.Color.argb(115, 255, 255, 255) // white 45 %
                textSize    = 3.5f * sy
                textAlign   = NativePaint.Align.CENTER
                isAntiAlias = true
                typeface    = Typeface.SANS_SERIF
            }
            canvas.nativeCanvas.drawText("nail lacquer", 32f * sx, 98f * sy, subPaint)
        }
    }
}
