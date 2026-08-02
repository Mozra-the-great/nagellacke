package de.nagellacke.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.TypeConverter
import androidx.room.TypeConverters
import de.nagellacke.domain.model.ManicurePhotos
import de.nagellacke.domain.model.PolishRef
import de.nagellacke.domain.model.StickerRef
import de.nagellacke.domain.model.manicurePhotosFromJsonElement
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class ListConverter {
    private val json = Json

    @TypeConverter
    fun fromList(list: List<String>): String = json.encodeToString(list)

    @TypeConverter
    fun toList(raw: String): List<String> = runCatching { json.decodeFromString<List<String>>(raw) }.getOrDefault(emptyList())
}

class PolishRefListConverter {
    private val json = Json

    @TypeConverter
    fun fromPolishRefList(list: List<PolishRef>): String = json.encodeToString(list)

    @TypeConverter
    fun toPolishRefList(raw: String): List<PolishRef> =
        runCatching { json.decodeFromString<List<PolishRef>>(raw) }.getOrDefault(emptyList())
}

class StickerRefListConverter {
    private val json = Json

    @TypeConverter
    fun fromStickerRefList(list: List<StickerRef>): String = json.encodeToString(list)

    @TypeConverter
    fun toStickerRefList(raw: String): List<StickerRef> =
        runCatching { json.decodeFromString<List<StickerRef>>(raw) }.getOrDefault(emptyList())
}

class ManicurePhotosConverter {
    private val json = Json

    @TypeConverter
    fun fromManicurePhotos(photos: ManicurePhotos): String = json.encodeToString(photos)

    // Reads both the current named-slot object and pre-existing rows still holding the
    // legacy flat-array shape, so upgrading the app doesn't strand old local data.
    @TypeConverter
    fun toManicurePhotos(raw: String): ManicurePhotos =
        runCatching { manicurePhotosFromJsonElement(json.parseToJsonElement(raw)) }.getOrDefault(ManicurePhotos())
}

@Entity(tableName = "polishes")
@TypeConverters(ListConverter::class)
data class PolishEntity(
    @PrimaryKey val id: String,
    val name: String,
    val brand: String,
    val num: String,
    val color: String,
    val finish: String,
    val status: String,
    val count: Int,
    val categories: List<String>,
    val notes: String,
    val rating: Int,
    val photo: String?,
    val createdAt: Long,
    val updatedAt: Long,
    val deletedAt: Long?,
)

@Entity(tableName = "stickers")
@TypeConverters(ListConverter::class)
data class StickerEntity(
    @PrimaryKey val id: String,
    val name: String,
    val brand: String,
    val style: String,
    val type: String,
    val colors: List<String>,
    val status: String,
    val rating: Int,
    val notes: String,
    val photo: String?,
    val createdAt: Long,
    val updatedAt: Long,
    val deletedAt: Long?,
)

@Entity(tableName = "manicures")
@TypeConverters(ListConverter::class, PolishRefListConverter::class, StickerRefListConverter::class, ManicurePhotosConverter::class)
data class ManicureEntity(
    @PrimaryKey val id: String,
    val date: String,
    val polishIds: List<String>,
    val polishRefs: List<PolishRef>,
    val notes: String,
    val stickers: List<String>,
    val stickerRefs: List<StickerRef>,
    val photos: ManicurePhotos,
    val photo: String?,
    val createdAt: Long,
    val updatedAt: Long,
    val deletedAt: Long?,
)

@Entity(tableName = "categories")
data class CategoryEntity(
    @PrimaryKey val id: String,
    val label: String,
    val updatedAt: Long,
    val deletedAt: Long?,
)
