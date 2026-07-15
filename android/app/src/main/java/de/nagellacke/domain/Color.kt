package de.nagellacke.domain

/** Port of hexToHue from @nagellacke/core/utils.ts — with guard for invalid hex (N4). */
fun hexToHue(hex: String): Int {
    val clean = hex.trimStart('#')
    if (clean.length != 6) return 0
    val r = clean.substring(0, 2).toIntOrNull(16)?.div(255f) ?: return 0
    val g = clean.substring(2, 4).toIntOrNull(16)?.div(255f) ?: return 0
    val b = clean.substring(4, 6).toIntOrNull(16)?.div(255f) ?: return 0

    val max = maxOf(r, g, b)
    val min = minOf(r, g, b)
    val delta = max - min
    if (delta == 0f) return 0

    val h = when (max) {
        r -> ((g - b) / delta) % 6
        g -> (b - r) / delta + 2
        else -> (r - g) / delta + 4
    }
    return ((h * 60 + 360) % 360).toInt()
}

fun isValidHex(hex: String): Boolean {
    val clean = hex.trimStart('#')
    return clean.length == 6 && clean.all { it.isDigit() || it in 'a'..'f' || it in 'A'..'F' }
}

/** Ensures a hex color string has a leading `#`, so it always parses via android.graphics.Color.parseColor(). */
fun normalizeHex(hex: String): String = if (hex.startsWith("#")) hex else "#$hex"
