package de.nagellacke.domain

import de.nagellacke.domain.model.AppData
import de.nagellacke.domain.model.FinishType
import de.nagellacke.domain.model.Manicure
import de.nagellacke.domain.model.ManicurePhotos
import de.nagellacke.domain.model.Polish
import de.nagellacke.domain.model.PolishStatus
import de.nagellacke.domain.model.Sticker
import de.nagellacke.domain.model.StickerType
import org.junit.Assert.assertEquals
import org.junit.Test

class ExportImportTest {
    private fun polish(id: String, photo: String? = null) = Polish(
        id = id, name = id, brand = "", num = "", color = "#ff0000",
        finish = FinishType.Classic, status = PolishStatus.Ok, photo = photo, createdAt = 1L, updatedAt = 1L,
    )

    private fun sticker(id: String, photo: String? = null) = Sticker(
        id = id, name = id, type = StickerType.Accent, status = PolishStatus.Ok, photo = photo, createdAt = 1L, updatedAt = 1L,
    )

    @Test fun `collectPhotoFilenames gathers polish, sticker, and all five manicure photo fields`() {
        val data = AppData(
            polishes = listOf(polish("p1", "p1.jpg"), polish("p2", null)),
            stickers = listOf(sticker("s1", "s1.jpg")),
            manicures = listOf(
                Manicure(
                    id = "m1", photo = "legacy.jpg",
                    photos = ManicurePhotos(fingerRight = "fr.jpg", fingerLeft = "fl.jpg", thumbRight = "tr.jpg", thumbLeft = "tl.jpg"),
                    createdAt = 1L, updatedAt = 1L,
                ),
            ),
        )
        assertEquals(
            setOf("p1.jpg", "s1.jpg", "legacy.jpg", "fr.jpg", "fl.jpg", "tr.jpg", "tl.jpg"),
            collectPhotoFilenames(data),
        )
    }

    @Test fun `collectPhotoFilenames is empty for a collection with no photos`() {
        val data = AppData(polishes = listOf(polish("p1")), manicures = listOf(Manicure(id = "m1", createdAt = 1L, updatedAt = 1L)))
        assertEquals(emptySet<String>(), collectPhotoFilenames(data))
    }

    @Test fun `remapPhotoRefs rewrites every reference through the map`() {
        val data = AppData(
            polishes = listOf(polish("p1", "old-p.jpg")),
            stickers = listOf(sticker("s1", "old-s.jpg")),
            manicures = listOf(
                Manicure(
                    id = "m1", photo = "old-legacy.jpg",
                    photos = ManicurePhotos(fingerRight = "old-fr.jpg", thumbLeft = "old-tl.jpg"),
                    createdAt = 1L, updatedAt = 1L,
                ),
            ),
        )
        val map = mapOf(
            "old-p.jpg" to "new-p.jpg", "old-s.jpg" to "new-s.jpg", "old-legacy.jpg" to "new-legacy.jpg",
            "old-fr.jpg" to "new-fr.jpg", "old-tl.jpg" to "new-tl.jpg",
        )
        val remapped = remapPhotoRefs(data, map)

        assertEquals("new-p.jpg", remapped.polishes[0].photo)
        assertEquals("new-s.jpg", remapped.stickers[0].photo)
        assertEquals("new-legacy.jpg", remapped.manicures[0].photo)
        assertEquals("new-fr.jpg", remapped.manicures[0].photos.fingerRight)
        assertEquals("new-tl.jpg", remapped.manicures[0].photos.thumbLeft)
        assertEquals(null, remapped.manicures[0].photos.fingerLeft)
    }

    @Test fun `remapPhotoRefs leaves names with no map entry untouched`() {
        val data = AppData(polishes = listOf(polish("p1", "unmapped.jpg")))
        assertEquals("unmapped.jpg", remapPhotoRefs(data, emptyMap()).polishes[0].photo)
    }

    @Test fun `remapPhotoRefs leaves null photo fields null`() {
        val data = AppData(polishes = listOf(polish("p1", null)))
        assertEquals(null, remapPhotoRefs(data, mapOf("x" to "y")).polishes[0].photo)
    }
}
