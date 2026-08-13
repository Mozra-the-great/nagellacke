package de.nagellacke.domain

import de.nagellacke.domain.model.FilterState
import de.nagellacke.domain.model.FinishType
import de.nagellacke.domain.model.Polish
import de.nagellacke.domain.model.PolishStatus
import org.junit.Assert.assertEquals
import org.junit.Test

class FiltersTest {
    private fun polish(
        id: String,
        status: PolishStatus,
        createdAt: Long,
        deletedAt: Long? = null,
        finish: List<FinishType> = listOf(FinishType.Classic),
    ) = Polish(
        id = id, name = id, brand = "", num = "", color = "#ff0000",
        finish = finish, status = status, createdAt = createdAt, updatedAt = createdAt, deletedAt = deletedAt,
    )

    @Test fun `wishlistPolishes keeps only wish status, newest first`() {
        val polishes = listOf(
            polish("ok", PolishStatus.Ok, 100L),
            polish("wish-old", PolishStatus.Wish, 100L),
            polish("wish-new", PolishStatus.Wish, 200L),
            polish("empty", PolishStatus.Empty, 100L),
        )
        assertEquals(listOf("wish-new", "wish-old"), wishlistPolishes(polishes).map { it.id })
    }

    @Test fun `wishlistPolishes excludes soft-deleted items`() {
        val polishes = listOf(polish("wish", PolishStatus.Wish, 100L, deletedAt = 50L))
        assertEquals(emptyList<Polish>(), wishlistPolishes(polishes))
    }

    @Test fun `finish filter matches a polish that has the finish among several`() {
        val polishes = listOf(
            polish("multi", PolishStatus.Ok, 100L, finish = listOf(FinishType.TopCoat, FinishType.Glitter)),
            polish("other", PolishStatus.Ok, 100L, finish = listOf(FinishType.Matte)),
        )
        val result = filterPolishes(polishes, FilterState(finish = FinishType.Glitter))
        assertEquals(listOf("multi"), result.map { it.id })
    }

    @Test fun `finish filter excludes a polish that doesn't carry the finish at all`() {
        val polishes = listOf(polish("p1", PolishStatus.Ok, 100L, finish = listOf(FinishType.Matte)))
        assertEquals(emptyList<Polish>(), filterPolishes(polishes, FilterState(finish = FinishType.Glitter)))
    }

    @Test fun `null finish filter keeps every polish regardless of its finishes`() {
        val polishes = listOf(
            polish("p1", PolishStatus.Ok, 100L, finish = listOf(FinishType.Matte)),
            polish("p2", PolishStatus.Ok, 100L, finish = listOf(FinishType.Glitter, FinishType.TopCoat)),
        )
        assertEquals(2, filterPolishes(polishes, FilterState(finish = null)).size)
    }
}
