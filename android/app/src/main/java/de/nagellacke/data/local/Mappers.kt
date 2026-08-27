package de.nagellacke.data.local

import de.nagellacke.domain.model.Category
import de.nagellacke.domain.model.Manicure
import de.nagellacke.domain.model.Polish
import de.nagellacke.domain.model.PolishStatus
import de.nagellacke.domain.model.Sticker
import de.nagellacke.domain.model.StickerType

// FinishType list stored as a JSON array of labels (e.g. ["Top Coat","Glitter"]) via
// FinishListConverter, which already guarantees a non-empty list, so no extra normalization
// needed here.
fun PolishEntity.toDomain() = Polish(
    id = id, name = name, brand = brand, num = num, color = color,
    finish = finish,
    status = PolishStatus.entries.firstOrNull { it.name.equals(status, ignoreCase = true) } ?: PolishStatus.Ok,
    count = count, categories = categories, notes = notes, rating = rating, photo = photo,
    createdAt = createdAt, updatedAt = updatedAt, deletedAt = deletedAt,
)

fun Polish.toEntity() = PolishEntity(
    id = id, name = name, brand = brand, num = num, color = color,
    finish = finish,
    status = status.name,
    count = count, categories = categories, notes = notes, rating = rating, photo = photo,
    createdAt = createdAt, updatedAt = updatedAt, deletedAt = deletedAt,
)

fun StickerEntity.toDomain() = Sticker(
    id = id, name = name, brand = brand, style = style,
    type = StickerType.entries.firstOrNull { it.name.equals(type, ignoreCase = true) } ?: StickerType.Full,
    colors = colors,
    status = PolishStatus.entries.firstOrNull { it.name.equals(status, ignoreCase = true) } ?: PolishStatus.Ok,
    rating = rating, notes = notes, photo = photo,
    createdAt = createdAt, updatedAt = updatedAt, deletedAt = deletedAt,
)

fun Sticker.toEntity() = StickerEntity(
    id = id, name = name, brand = brand, style = style, type = type.name, colors = colors,
    status = status.name, rating = rating, notes = notes, photo = photo,
    createdAt = createdAt, updatedAt = updatedAt, deletedAt = deletedAt,
)

fun ManicureEntity.toDomain() = Manicure(
    id = id, date = date, polishIds = polishIds, polishRefs = polishRefs, notes = notes,
    stickers = stickers, stickerRefs = stickerRefs, photos = photos, photo = photo,
    createdAt = createdAt, updatedAt = updatedAt, deletedAt = deletedAt,
)

fun Manicure.toEntity() = ManicureEntity(
    id = id, date = date, polishIds = polishIds, polishRefs = polishRefs, notes = notes,
    stickers = stickers, stickerRefs = stickerRefs, photos = photos, photo = photo,
    createdAt = createdAt, updatedAt = updatedAt, deletedAt = deletedAt,
)

fun CategoryEntity.toDomain() = Category(
    id = id, label = label, updatedAt = updatedAt, deletedAt = deletedAt,
)

fun Category.toEntity() = CategoryEntity(
    id = id, label = label, updatedAt = updatedAt, deletedAt = deletedAt,
)
