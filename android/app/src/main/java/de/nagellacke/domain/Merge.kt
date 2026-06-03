package de.nagellacke.domain

import de.nagellacke.domain.model.AppData
import de.nagellacke.domain.model.Category
import de.nagellacke.domain.model.Manicure
import de.nagellacke.domain.model.Polish
import de.nagellacke.domain.model.Sticker

/**
 * Port of mergeData/mergeList from @nagellacke/core/logic.ts.
 * Last updatedAt wins per item; soft-deleted items are retained for cross-device propagation.
 * Purge of old deletedAt happens separately in SyncManager (N3).
 */
fun mergeData(local: AppData, remote: AppData): AppData = AppData(
    polishes   = mergeList(local.polishes, remote.polishes, Polish::id, Polish::updatedAt) { a, b -> if (b.updatedAt > a.updatedAt) b else a },
    customCats = mergeList(local.customCats, remote.customCats, Category::id, Category::updatedAt) { a, b -> if (b.updatedAt > a.updatedAt) b else a },
    manicures  = mergeList(local.manicures, remote.manicures, Manicure::id, Manicure::updatedAt) { a, b -> if (b.updatedAt > a.updatedAt) b else a },
    stickers   = mergeList(local.stickers, remote.stickers, Sticker::id, Sticker::updatedAt) { a, b -> if (b.updatedAt > a.updatedAt) b else a },
)

private fun <T> mergeList(
    local: List<T>,
    remote: List<T>,
    id: (T) -> String,
    @Suppress("UNUSED_PARAMETER") updatedAt: (T) -> Long,
    winner: (existing: T, incoming: T) -> T,
): List<T> {
    val map = LinkedHashMap<String, T>()
    for (item in local) map[id(item)] = item
    for (item in remote) {
        val existing = map[id(item)]
        map[id(item)] = if (existing == null) item else winner(existing, item)
    }
    return map.values.toList()
}

fun purgeOldDeleted(data: AppData, olderThanMs: Long = 90L * 24 * 60 * 60 * 1000): AppData {
    val cutoff = System.currentTimeMillis() - olderThanMs
    return data.copy(
        polishes   = data.polishes.filter   { it.deletedAt == null || it.deletedAt > cutoff },
        customCats = data.customCats.filter { it.deletedAt == null || it.deletedAt > cutoff },
        manicures  = data.manicures.filter  { it.deletedAt == null || it.deletedAt > cutoff },
        stickers   = data.stickers.filter   { it.deletedAt == null || it.deletedAt > cutoff },
    )
}
