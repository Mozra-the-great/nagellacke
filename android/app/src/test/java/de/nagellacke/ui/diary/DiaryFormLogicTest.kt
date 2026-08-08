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
            listOf(PolishRef(name = "Rose Gold", brand = "OPI", color = "#ffc0cb")),
            buildPolishRefs(listOf("p1"), available),
        )
    }

    @Test fun `buildPolishRefs drops ids that no longer resolve`() {
        assertEquals(emptyList<PolishRef>(), buildPolishRefs(listOf("gone"), listOf(polish("p1", "Rose Gold"))))
    }
}
