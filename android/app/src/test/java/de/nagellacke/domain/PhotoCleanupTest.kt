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

/** #348: which queued photos SyncManager may delete on the sync target after a sync. */
class PhotoCleanupTest {
    private fun polish(id: String, photo: String?, deletedAt: Long? = null) = Polish(
        id = id, name = id, brand = "", num = "", color = "#ff0000",
        finish = listOf(FinishType.Classic), status = PolishStatus.Ok, photo = photo,
        createdAt = 1L, updatedAt = 1L, deletedAt = deletedAt,
    )

    private fun sticker(id: String, photo: String?, deletedAt: Long? = null) = Sticker(
        id = id, name = id, type = StickerType.Accent, status = PolishStatus.Ok, photo = photo,
        createdAt = 1L, updatedAt = 1L, deletedAt = deletedAt,
    )

    @Test fun `photosOf a manicure covers the legacy photo and all four slots`() {
        val m = Manicure(
            id = "m1", photo = "legacy.jpg",
            photos = ManicurePhotos(fingerRight = "fr.jpg", thumbLeft = "tl.jpg"),
            createdAt = 1L, updatedAt = 1L,
        )
        assertEquals(setOf("legacy.jpg", "fr.jpg", "tl.jpg"), photosOf(m))
    }

    @Test fun `a photo only a tombstone references is deletable`() {
        val data = AppData(polishes = listOf(polish("p1", "gone.jpg", deletedAt = 5L)))
        val (deletable, inUse) = partitionPendingPhotoDeletes(setOf("gone.jpg"), data)
        assertEquals(setOf("gone.jpg"), deletable)
        assertEquals(emptySet<String>(), inUse)
    }

    @Test fun `a replaced photo nothing references any more is deletable`() {
        val data = AppData(polishes = listOf(polish("p1", "new.jpg")))
        val (deletable, _) = partitionPendingPhotoDeletes(setOf("old.jpg"), data)
        assertEquals(setOf("old.jpg"), deletable)
    }

    @Test fun `a photo a live record references again is kept`() {
        // Another device edited the record after this one deleted it, and the merge kept the
        // edit; or a second record shares the file.
        val data = AppData(
            polishes = listOf(polish("p1", "shared.jpg", deletedAt = 5L)),
            stickers = listOf(sticker("s1", "shared.jpg")),
        )
        val (deletable, inUse) = partitionPendingPhotoDeletes(setOf("shared.jpg", "other.jpg"), data)
        assertEquals(setOf("other.jpg"), deletable)
        assertEquals(setOf("shared.jpg"), inUse)
    }

    @Test fun `collectLivePhotoFilenames ignores soft-deleted manicures`() {
        val data = AppData(
            manicures = listOf(
                Manicure(id = "m1", photo = "dead.jpg", createdAt = 1L, updatedAt = 1L, deletedAt = 2L),
                Manicure(id = "m2", photos = ManicurePhotos(fingerLeft = "live.jpg"), createdAt = 1L, updatedAt = 1L),
            ),
        )
        assertEquals(setOf("live.jpg"), collectLivePhotoFilenames(data))
    }
}
