package de.nagellacke.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.TypeConverter
import androidx.room.TypeConverters
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class ListConverter {
    private val json = Json

    @TypeConverter
    fun fromList(list: List<String>): String = json.encodeToString(list)

    @TypeConverter
    fun toList(raw: String): List<String> = runCatching { json.decodeFromString<List<String>>(raw) }.getOrDefault(emptyList())
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
@TypeConverters(ListConverter::class)
data class ManicureEntity(
    @PrimaryKey val id: String,
    val date: String,
    val polishIds: List<String>,
    val notes: String,
    val photos: List<String>,
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
