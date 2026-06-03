package de.nagellacke.domain

import de.nagellacke.domain.model.FinishType
import de.nagellacke.domain.model.Polish
import de.nagellacke.domain.model.PolishStatus
import de.nagellacke.domain.model.Sticker
import de.nagellacke.domain.model.StickerType

val FINISH_OPTIONS = FinishType.entries
val STATUS_OPTIONS = PolishStatus.entries
val STICKER_TYPE_OPTIONS = StickerType.entries

val SHIMMER_FINISHES = setOf(
    FinishType.Shimmer, FinishType.Glitter, FinishType.Metallic,
    FinishType.Chrome, FinishType.Holographic, FinishType.Duochrome,
)

val BRAND_SUGGESTIONS = listOf(
    "Alessandro", "Barry M", "Butter London", "Catrice", "Chanel",
    "China Glaze", "CND", "Color Street", "Dance Legend", "Deborah Lippmann",
    "Depend", "Dior", "E.Mi", "Essie", "Flormar", "Gelish",
    "Golden Rose", "IBD", "Inglot", "IsaDora", "Kiko Milano",
    "Kiara Sky", "Kure Bazaar", "L.A. Colors", "Lancôme",
    "MAC", "Manucurist", "Maybelline", "Models Own",
    "Nailberry", "Nails Inc.", "NYX", "OPI", "Orly",
    "Pastel", "Revlon", "Rimmel", "Sally Hansen",
    "The Body Shop", "Wet n Wild", "YSL", "Zoya",
)

val STICKER_STYLE_SUGGESTIONS = listOf(
    "Blumen", "Geometrisch", "Abstrakt", "Glitzer", "Französisch",
    "Weihnachten", "Halloween", "Sommer", "Herzen", "Sterne",
    "Tiere", "Früchte", "Botanisch", "Marble", "Japanisch",
)

fun defaultPolish(now: Long): Polish = Polish(
    id = "", name = "", brand = "", num = "",
    color = "#ff6699", finish = FinishType.Classic, status = PolishStatus.Ok,
    count = 1, categories = emptyList(), notes = "", rating = 0, photo = null,
    createdAt = now, updatedAt = now,
)

fun defaultSticker(now: Long): Sticker = Sticker(
    id = "", name = "", brand = "", style = "",
    type = StickerType.Accent, colors = listOf("#ff6699"),
    status = PolishStatus.Ok, rating = 0, notes = "", photo = null,
    createdAt = now, updatedAt = now,
)

fun generateId(): String = "${System.currentTimeMillis()}-${(Math.random() * 1_000_000).toLong()}"
