package de.nagellacke.domain.model

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.decodeFromJsonElement

@Serializable
data class PolishRef(
    val id: String? = null,
    val name: String = "",
    val brand: String? = null,
    val color: String? = null,
)

@Serializable
data class StickerRef(
    val id: String = "",
    val name: String = "",
    val colors: List<String>? = null,
)

@Serializable
data class ManicurePhotos(
    val fingerRight: String? = null,
    val fingerLeft: String? = null,
    val thumbRight: String? = null,
    val thumbLeft: String? = null,
)

/** Maps a flat, order-based photo list onto named slots (finger before thumb, right before left). */
fun List<String>.toManicurePhotos(): ManicurePhotos = ManicurePhotos(
    fingerRight = getOrNull(0),
    fingerLeft = getOrNull(1),
    thumbRight = getOrNull(2),
    thumbLeft = getOrNull(3),
)

/** Flattens named photo slots back into an order-based list, dropping empty slots. */
fun ManicurePhotos.toFlatList(): List<String> = listOfNotNull(fingerRight, fingerLeft, thumbRight, thumbLeft)

// Shared by FlexiblePhotosSerializer (network JSON) and ManicurePhotosConverter (Room
// column) so both agree on how legacy shapes map onto named slots.
internal fun manicurePhotosFromJsonElement(element: JsonElement): ManicurePhotos = when (element) {
    is JsonObject -> runCatching { Json.decodeFromJsonElement(ManicurePhotos.serializer(), element) }.getOrDefault(ManicurePhotos())
    is JsonArray -> element.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }.toManicurePhotos()
    else -> ManicurePhotos()
}

// The web app stores manicure photos as a named-slot object (current format) or, in
// older data, as a flat array of filenames whose slot identity is already lost. This
// serializer accepts both shapes but always re-emits the named-slot object, so slot
// data survives future round-trips instead of collapsing back into an array.
private object FlexiblePhotosSerializer : KSerializer<ManicurePhotos> {
    private val delegate = ManicurePhotos.serializer()
    override val descriptor = delegate.descriptor

    override fun deserialize(decoder: Decoder): ManicurePhotos {
        val jsonDecoder = decoder as? JsonDecoder ?: return delegate.deserialize(decoder)
        return manicurePhotosFromJsonElement(jsonDecoder.decodeJsonElement())
    }

    override fun serialize(encoder: Encoder, value: ManicurePhotos) = delegate.serialize(encoder, value)
}

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
    @SerialName("polishes") val polishIds: List<String> = emptyList(),
    val polishRefs: List<PolishRef> = emptyList(),
    val notes: String = "",
    val stickers: List<String> = emptyList(),
    val stickerRefs: List<StickerRef> = emptyList(),
    @Serializable(with = FlexiblePhotosSerializer::class) val photos: ManicurePhotos = ManicurePhotos(),
    val photo: String? = null,
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
