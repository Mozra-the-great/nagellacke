package de.nagellacke.domain

/**
 * Pure helpers behind the "Farbe aus Foto" picker (port of ColorFromPhoto.tsx's canvas
 * pixel-sampling). Kept free of android.graphics so they're plain-JUnit testable — Bitmap.getPixel
 * returns a packed ARGB int in the same bit layout android.graphics.Color uses, so manual bit
 * shifting is equivalent to Color.red/green/blue without needing Robolectric.
 */

/** Extracts `#RRGGBB` from a packed ARGB int (as returned by [android.graphics.Bitmap.getPixel]). */
fun argbToHex(argb: Int): String {
    val r = (argb shr 16) and 0xFF
    val g = (argb shr 8) and 0xFF
    val b = argb and 0xFF
    return "#%02X%02X%02X".format(r, g, b)
}

/**
 * Maps a tap/drag position within a displayed image (whose layout box exactly matches the
 * bitmap's aspect ratio — see [de.nagellacke.ui.common.ColorFromPhotoDialog]) back to the
 * corresponding bitmap pixel coordinates, clamped to valid bounds.
 */
fun mapToBitmapPixel(offsetX: Float, offsetY: Float, viewWidth: Float, viewHeight: Float, bitmapWidth: Int, bitmapHeight: Int): Pair<Int, Int> {
    if (viewWidth <= 0f || viewHeight <= 0f || bitmapWidth <= 0 || bitmapHeight <= 0) return 0 to 0
    val x = ((offsetX / viewWidth) * bitmapWidth).toInt().coerceIn(0, bitmapWidth - 1)
    val y = ((offsetY / viewHeight) * bitmapHeight).toInt().coerceIn(0, bitmapHeight - 1)
    return x to y
}
