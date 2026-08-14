package de.nagellacke.ui.diary

import de.nagellacke.domain.model.FinishType
import de.nagellacke.domain.model.Manicure
import de.nagellacke.domain.model.Polish
import de.nagellacke.domain.model.PolishRef
import de.nagellacke.domain.model.PolishStatus
import de.nagellacke.domain.model.Sticker
import de.nagellacke.domain.model.StickerRef
import de.nagellacke.domain.model.StickerType
import org.junit.Assert.assertEquals
import org.junit.Test

/** Regression coverage for #145: sticker/polish refs must survive editing on Android. */
class DiaryFormLogicTest {
    private fun sticker(id: String, name: String, colors: List<String>? = listOf("#ff0000")) = Sticker(
        id = id, name = name, brand = "", style = "", type = StickerType.Accent, colors = colors ?: emptyList(),
        status = PolishStatus.Ok, createdAt = 1L, updatedAt = 1L,
    )

    private fun polish(id: String, name: String, brand: String = "OPI", color: String = "#ff6699") = Polish(
        id = id, name = name, brand = brand, num = "", color = color,
        finish = listOf(FinishType.Classic), status = PolishStatus.Ok, createdAt = 1L, updatedAt = 1L,
    )

    @Test fun `resolveStickerRefs returns null entry as empty`() {
        assertEquals(emptyList<StickerRef>(), resolveStickerRefs(null, listOf(sticker("s1", "Herz"))))
    }

    @Test fun `resolveStickerRefs prefers existing stickerRefs over legacy stickers`() {
        val entry = Manicure(
            id = "m1", stickerRefs = listOf(StickerRef(id = "s1", name = "Herz", colors = listOf("#ff0000"))),
            stickers = listOf("s2"), createdAt = 1L, updatedAt = 1L,
        )
        val available = listOf(sticker("s1", "Herz"), sticker("s2", "Stern"))
        assertEquals(listOf(StickerRef(id = "s1", name = "Herz", colors = listOf("#ff0000"))), resolveStickerRefs(entry, available))
    }

    @Test fun `resolveStickerRefs falls back to matching legacy stickers by id`() {
        val entry = Manicure(id = "m1", stickers = listOf("s1", "s2"), createdAt = 1L, updatedAt = 1L)
        val available = listOf(sticker("s1", "Herz", colors = listOf("#ff0000")), sticker("s2", "Stern", colors = listOf("#00ff00")))
        assertEquals(
            listOf(StickerRef(id = "s1", name = "Herz", colors = listOf("#ff0000")), StickerRef(id = "s2", name = "Stern", colors = listOf("#00ff00"))),
            resolveStickerRefs(entry, available),
        )
    }

    @Test fun `resolveStickerRefs falls back to matching legacy stickers by name`() {
        val entry = Manicure(id = "m1", stickers = listOf("Herz"), createdAt = 1L, updatedAt = 1L)
        val available = listOf(sticker("s1", "Herz"))
        assertEquals(listOf(StickerRef(id = "s1", name = "Herz", colors = listOf("#ff0000"))), resolveStickerRefs(entry, available))
    }

    @Test fun `resolveStickerRefs drops legacy ids that no longer resolve`() {
        val entry = Manicure(id = "m1", stickers = listOf("gone"), createdAt = 1L, updatedAt = 1L)
        assertEquals(emptyList<StickerRef>(), resolveStickerRefs(entry, listOf(sticker("s1", "Herz"))))
    }

    @Test fun `buildPolishRefs maps selected ids to current polish data`() {
        val available = listOf(polish("p1", "Rose Gold", "OPI", "#ffc0cb"), polish("p2", "Blau", "Essie", "#0000ff"))
        assertEquals(
            listOf(PolishRef(id = "p1", name = "Rose Gold", brand = "OPI", color = "#ffc0cb")),
            buildPolishRefs(listOf("p1"), available),
        )
    }

    @Test fun `buildPolishRefs drops ids that no longer resolve`() {
        assertEquals(emptyList<PolishRef>(), buildPolishRefs(listOf("gone"), listOf(polish("p1", "Rose Gold"))))
    }

    // #219: refs carry an id now, so a rename on another device no longer breaks the link.
    // Legacy refs written before that have no id and still have to match by name+brand.

    @Test fun `resolvePolishIds returns null entry as empty`() {
        assertEquals(emptyList<String>(), resolvePolishIds(null, listOf(polish("p1", "Rose Gold"))))
    }

    @Test fun `resolvePolishIds falls back to polishIds when there are no refs`() {
        val entry = Manicure(id = "m1", polishIds = listOf("p1"), createdAt = 1L, updatedAt = 1L)
        assertEquals(listOf("p1"), resolvePolishIds(entry, listOf(polish("p1", "Rose Gold"))))
    }

    // The case from the issue: renamed elsewhere, so the ref's name is stale but its id is not.
    @Test fun `resolvePolishIds matches by id even when the name has changed`() {
        val entry = Manicure(
            id = "m1", polishIds = listOf("p1"),
            polishRefs = listOf(PolishRef(id = "p1", name = "Alter Name", brand = "OPI", color = "#ffc0cb")),
            createdAt = 1L, updatedAt = 1L,
        )
        assertEquals(listOf("p1"), resolvePolishIds(entry, listOf(polish("p1", "Neuer Name"))))
    }

    // Legacy ref (no id) after an import renumbered the ids: name+brand is all there is to go on.
    @Test fun `resolvePolishIds falls back to name and brand for a legacy ref`() {
        val entry = Manicure(
            id = "m1", polishIds = listOf("old-id"),
            polishRefs = listOf(PolishRef(name = "Rose Gold", brand = "OPI", color = "#ffc0cb")),
            createdAt = 1L, updatedAt = 1L,
        )
        assertEquals(listOf("new-id"), resolvePolishIds(entry, listOf(polish("new-id", "Rose Gold", "OPI"))))
    }

    @Test fun `resolvePolishIds does not match a legacy ref across a different brand`() {
        val entry = Manicure(
            id = "m1", polishRefs = listOf(PolishRef(name = "Rose Gold", brand = "OPI")),
            createdAt = 1L, updatedAt = 1L,
        )
        assertEquals(emptyList<String>(), resolvePolishIds(entry, listOf(polish("p1", "Rose Gold", "Essie"))))
    }

    // Two legacy refs that both fall back to the same name+brand must not collapse onto one
    // polish - the `used` set is what keeps them apart.
    @Test fun `resolvePolishIds does not assign the same polish to two legacy refs`() {
        val entry = Manicure(
            id = "m1",
            polishRefs = listOf(PolishRef(name = "Rose Gold", brand = "OPI"), PolishRef(name = "Rose Gold", brand = "OPI")),
            createdAt = 1L, updatedAt = 1L,
        )
        val available = listOf(polish("p1", "Rose Gold", "OPI"), polish("p2", "Rose Gold", "OPI"))
        assertEquals(listOf("p1", "p2"), resolvePolishIds(entry, available))
    }

    @Test fun `resolvePolishIds drops a ref that resolves to nothing`() {
        val entry = Manicure(
            id = "m1",
            polishRefs = listOf(PolishRef(id = "gone", name = "Weg", brand = "OPI"), PolishRef(id = "p1", name = "Rose Gold", brand = "OPI")),
            createdAt = 1L, updatedAt = 1L,
        )
        assertEquals(listOf("p1"), resolvePolishIds(entry, listOf(polish("p1", "Rose Gold", "OPI"))))
    }

    // A ref whose id is gone (deleted, or renumbered by an import) but whose name+brand still
    // describe an existing polish should recover through the fallback rather than vanish.
    @Test fun `resolvePolishIds recovers a ref whose id no longer exists via name and brand`() {
        val entry = Manicure(
            id = "m1",
            polishRefs = listOf(PolishRef(id = "stale", name = "Rose Gold", brand = "OPI")),
            createdAt = 1L, updatedAt = 1L,
        )
        assertEquals(listOf("p1"), resolvePolishIds(entry, listOf(polish("p1", "Rose Gold", "OPI"))))
    }
}
