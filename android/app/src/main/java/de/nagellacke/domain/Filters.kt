package de.nagellacke.domain

import de.nagellacke.domain.model.FilterState
import de.nagellacke.domain.model.Manicure
import de.nagellacke.domain.model.Polish
import de.nagellacke.domain.model.SortOption
import de.nagellacke.domain.model.Sticker

fun filterPolishes(polishes: List<Polish>, f: FilterState): List<Polish> =
    polishes.filter { p ->
        if (p.deletedAt != null) return@filter false
        if (f.status != null && p.status != f.status) return@filter false
        if (f.finish != null && p.finish != f.finish) return@filter false
        if (f.brand.isNotBlank() && p.brand != f.brand) return@filter false
        if (f.category.isNotBlank() && !p.categories.contains(f.category)) return@filter false
        if (f.search.isNotBlank()) {
            val q = f.search.lowercase()
            p.name.lowercase().contains(q) ||
                p.brand.lowercase().contains(q) ||
                p.num.lowercase().contains(q) ||
                p.finish.label.lowercase().contains(q) ||
                p.notes.lowercase().contains(q)
        } else true
    }

fun sortPolishes(polishes: List<Polish>, sort: SortOption): List<Polish> =
    when (sort) {
        SortOption.Newest  -> polishes.sortedByDescending { it.createdAt }
        SortOption.Oldest  -> polishes.sortedBy          { it.createdAt }
        SortOption.Name    -> polishes.sortedBy          { it.name }
        SortOption.Brand   -> polishes.sortedBy          { it.brand }
        SortOption.Hue     -> polishes.sortedBy          { hexToHue(it.color) }
        SortOption.Rating  -> polishes.sortedByDescending { it.rating }
    }

fun filterStickers(stickers: List<Sticker>, search: String): List<Sticker> {
    if (search.isBlank()) return stickers.filter { it.deletedAt == null }
    val q = search.lowercase()
    return stickers.filter { s ->
        s.deletedAt == null &&
            (s.name.lowercase().contains(q) ||
                s.brand.lowercase().contains(q) ||
                s.style.lowercase().contains(q))
    }
}

fun filterManicures(manicures: List<Manicure>): List<Manicure> =
    manicures.filter { it.deletedAt == null }
