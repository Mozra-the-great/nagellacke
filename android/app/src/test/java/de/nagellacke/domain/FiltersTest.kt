package de.nagellacke.domain

import de.nagellacke.domain.model.FinishType
import de.nagellacke.domain.model.Polish
import de.nagellacke.domain.model.PolishStatus
import org.junit.Assert.assertEquals
import org.junit.Test

class FiltersTest {
    private fun polish(id: String, status: PolishStatus, createdAt: Long, deletedAt: Long? = null) = Polish(
        id = id, name = id, brand = "", num = "", color = "#ff0000",
        finish = FinishType.Classic, status = status, createdAt = createdAt, updatedAt = createdAt, deletedAt = deletedAt,
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
}
