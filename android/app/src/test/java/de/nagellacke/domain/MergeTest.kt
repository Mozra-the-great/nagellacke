package de.nagellacke.domain

import de.nagellacke.domain.model.AppData
import de.nagellacke.domain.model.FinishType
import de.nagellacke.domain.model.Polish
import de.nagellacke.domain.model.PolishStatus
import org.junit.Assert.assertEquals
import org.junit.Test

class MergeTest {
    private fun polish(id: String, name: String, updatedAt: Long, deletedAt: Long? = null) = Polish(
        id = id, name = name, brand = "", num = "", color = "#ff0000",
        finish = FinishType.Classic, status = PolishStatus.Ok,
        createdAt = 1000L, updatedAt = updatedAt, deletedAt = deletedAt,
    )

    @Test fun `remote wins when updatedAt is newer`() {
        val local = AppData(polishes = listOf(polish("1", "old", 100L)))
        val remote = AppData(polishes = listOf(polish("1", "new", 200L)))
        val merged = mergeData(local, remote)
        assertEquals("new", merged.polishes.first().name)
    }

    @Test fun `local wins when updatedAt is newer`() {
        val local = AppData(polishes = listOf(polish("1", "new", 200L)))
        val remote = AppData(polishes = listOf(polish("1", "old", 100L)))
        val merged = mergeData(local, remote)
        assertEquals("new", merged.polishes.first().name)
    }

    @Test fun `items unique to one side are included`() {
        val local = AppData(polishes = listOf(polish("1", "a", 100L)))
        val remote = AppData(polishes = listOf(polish("2", "b", 100L)))
        val merged = mergeData(local, remote)
        assertEquals(2, merged.polishes.size)
    }

    @Test fun `soft-deleted items are retained for propagation`() {
        val local = AppData(polishes = listOf(polish("1", "x", 100L, deletedAt = 50L)))
        val remote = AppData(polishes = emptyList())
        val merged = mergeData(local, remote)
        assertEquals(1, merged.polishes.size)
        assertEquals(50L, merged.polishes.first().deletedAt)
    }

    @Test fun `purge removes old deleted items`() {
        val old = polish("1", "gone", 100L, deletedAt = 1L)
        val recent = polish("2", "recent", 200L, deletedAt = System.currentTimeMillis() - 1000)
        val active = polish("3", "active", 300L)
        val data = AppData(polishes = listOf(old, recent, active))
        val purged = purgeOldDeleted(data)
        assertEquals(2, purged.polishes.size)
        assert(purged.polishes.none { it.id == "1" })
    }
}
