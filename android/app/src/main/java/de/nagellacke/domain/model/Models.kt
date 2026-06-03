package de.nagellacke.domain.model

import kotlinx.serialization.Serializable

@Serializable
enum class FinishType(val label: String, val icon: String) {
    Classic("Classic", "●"),
    Shimmer("Shimmer", "✨"),
    Glitter("Glitter", "✦"),
    Metallic("Metallic", "◉"),
    Chrome("Chrome", "◎"),
    Matte("Matte", "◼"),
    Satin("Satin", "◈"),
    Duochrome("Duochrome", "◑"),
    Holographic("Holographic", "◇"),
    Jelly("Jelly", "○"),
    Neon("Neon", "◆"),
    Magnetic("Magnetic", "⬡"),
    GelLook("Gel Look", "◐"),
    TopCoat("Top Coat", "▽"),
    BaseCoat("Base Coat", "△"),
}

@Serializable
enum class PolishStatus(val label: String) {
    Ok("Vorhanden"),
    Wish("Wunschliste"),
    Empty("Leer"),
    Gone("Nicht mehr da"),
}

@Serializable
enum class StickerType(val label: String, val icon: String) {
    Full("Full Cover", "▬"),
    Accent("Akzent", "◆"),
    Wrap("Nail Wrap", "◌"),
    ThreeD("3D", "●"),
    Foil("Folie", "✦"),
    Slider("Slider", "◎"),
}

@Serializable
enum class SortOption(val label: String) {
    Newest("Neueste"),
    Oldest("Älteste"),
    Name("Name"),
    Brand("Marke"),
    Hue("Farbe"),
    Rating("Bewertung"),
}

@Serializable
data class Polish(
    val id: String,
    val name: String,
    val brand: String,
    val num: String,
    val color: String,
    val finish: FinishType,
    val status: PolishStatus,
    val count: Int = 1,
    val categories: List<String> = emptyList(),
    val notes: String = "",
    val rating: Int = 0,
    val photo: String? = null,
    val createdAt: Long,
    val updatedAt: Long,
    val deletedAt: Long? = null,
)

@Serializable
data class Sticker(
    val id: String,
    val name: String,
    val brand: String = "",
    val style: String = "",
    val type: StickerType,
    val colors: List<String> = listOf("#ff6699"),
    val status: PolishStatus,
    val rating: Int = 0,
    val notes: String = "",
    val photo: String? = null,
    val createdAt: Long,
    val updatedAt: Long,
    val deletedAt: Long? = null,
)

@Serializable
data class Manicure(
    val id: String,
    val date: String,
    val polishIds: List<String>,
    val notes: String = "",
    val photos: List<String> = emptyList(),
    val createdAt: Long,
    val updatedAt: Long,
    val deletedAt: Long? = null,
)

@Serializable
data class Category(
    val id: String,
    val label: String,
    val updatedAt: Long,
    val deletedAt: Long? = null,
)

@Serializable
data class AppData(
    val polishes: List<Polish> = emptyList(),
    val customCats: List<Category> = emptyList(),
    val manicures: List<Manicure> = emptyList(),
    val stickers: List<Sticker> = emptyList(),
)

data class FilterState(
    val search: String = "",
    val finish: FinishType? = null,
    val category: String = "",
    val status: PolishStatus? = null,
    val brand: String = "",
    val sort: SortOption = SortOption.Newest,
)
