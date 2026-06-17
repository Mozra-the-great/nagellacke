package de.nagellacke.domain.model

import kotlinx.serialization.SerialName
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
    @SerialName("Gel Look") GelLook("Gel Look", "◐"),
    @SerialName("Top Coat") TopCoat("Top Coat", "▽"),
    @SerialName("Base Coat") BaseCoat("Base Coat", "△"),
}

@Serializable
enum class PolishStatus(val label: String) {
    @SerialName("ok")   Ok("Vorhanden"),
    @SerialName("wish") Wish("Wunschliste"),
    @SerialName("empty") Empty("Leer"),
    @SerialName("gone") Gone("Nicht mehr da"),
}

@Serializable
enum class StickerType(val label: String, val icon: String) {
    @SerialName("full")   Full("Full Cover", "▬"),
    @SerialName("accent") Accent("Akzent", "◆"),
    @SerialName("wrap")   Wrap("Nail Wrap", "◌"),
    @SerialName("3d")     ThreeD("3D", "●"),
    @SerialName("foil")   Foil("Folie", "✦"),
    @SerialName("slider") Slider("Slider", "◎"),
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
    val name: String = "",
    val brand: String = "",
    val num: String = "",
    val color: String = "#ff6699",
    val finish: FinishType = FinishType.Classic,
    val status: PolishStatus = PolishStatus.Ok,
    val count: Int = 1,
    val categories: List<String> = emptyList(),
    val notes: String = "",
    val rating: Int = 0,
    val photo: String? = null,
    val createdAt: Long = 0L,
    val updatedAt: Long = 0L,
    val deletedAt: Long? = null,
)

@Serializable
data class Sticker(
    val id: String,
    val name: String = "",
    val brand: String = "",
    val style: String = "",
    val type: StickerType = StickerType.Full,
    val colors: List<String> = listOf("#ff6699"),
    val status: PolishStatus = PolishStatus.Ok,
    val rating: Int = 0,
    val notes: String = "",
    val photo: String? = null,
    val createdAt: Long = 0L,
    val updatedAt: Long = 0L,
    val deletedAt: Long? = null,
)

@Serializable
data class Manicure(
    val id: String,
    val date: String = "",
    val polishIds: List<String> = emptyList(),
    val notes: String = "",
    val photos: List<String> = emptyList(),
    val createdAt: Long = 0L,
    val updatedAt: Long = 0L,
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
