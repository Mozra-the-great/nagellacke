package de.nagellacke.domain.model

import de.nagellacke.data.local.toDomain
import de.nagellacke.data.local.toEntity
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Regression test for #141: a Manicure synced from the web app was silently losing
 * polishRefs, stickers, stickerRefs and the four named photo slots once it went
 * through the Android model, Room, and back — because those fields didn't exist on
 * the Android side, so unknown-key-tolerant JSON decoding just dropped them.
 */
class ManicureSyncTest {
    private val json = Json { ignoreUnknownKeys = true }

    // Mirrors a complete manicure as the web app (@nagellacke/core Manicure) would send it.
    private val fullManicureJson = """
        {
          "id": "m1",
          "date": "2026-08-01",
          "polishes": ["p1", "p2"],
          "polishRefs": [{"name":"Rose Gold","brand":"OPI","color":"#ffc0cb"}],
          "stickers": ["s1"],
          "stickerRefs": [{"id":"s1","name":"Herzchen","colors":["#ff0000","#ffffff"]}],
          "notes": "Testeintrag",
          "photos": {"fingerRight":"fr.jpg","fingerLeft":"fl.jpg","thumbRight":"tr.jpg","thumbLeft":"tl.jpg"},
          "photo": "legacy.jpg",
          "createdAt": 1000,
          "updatedAt": 2000,
          "deletedAt": null
        }
    """.trimIndent()

    @Test fun `full manicure survives decode, Room round-trip, and re-encode`() {
        val decoded = json.decodeFromString<Manicure>(fullManicureJson)

        assertEquals(listOf(PolishRef(name = "Rose Gold", brand = "OPI", color = "#ffc0cb")), decoded.polishRefs)
        assertEquals(listOf("s1"), decoded.stickers)
        assertEquals(listOf(StickerRef(id = "s1", name = "Herzchen", colors = listOf("#ff0000", "#ffffff"))), decoded.stickerRefs)
        assertEquals(ManicurePhotos(fingerRight = "fr.jpg", fingerLeft = "fl.jpg", thumbRight = "tr.jpg", thumbLeft = "tl.jpg"), decoded.photos)
        assertEquals("legacy.jpg", decoded.photo)

        // Deserialize -> save (toEntity) -> load (toDomain), as SyncManager does on every pull.
        val roundTripped = decoded.toEntity().toDomain()
        assertEquals(decoded, roundTripped)

        // Serialize again, as SyncManager does on every push: nothing may have been dropped.
        val reEncoded = json.decodeFromString<Manicure>(json.encodeToString(roundTripped))
        assertEquals(decoded, reEncoded)
    }

    @Test fun `legacy flat photo array decodes positionally and re-encodes as named slots`() {
        val legacy = """{"id":"m2","photos":["a.jpg","b.jpg"],"createdAt":1,"updatedAt":1}"""

        val decoded = json.decodeFromString<Manicure>(legacy)
        assertEquals(ManicurePhotos(fingerRight = "a.jpg", fingerLeft = "b.jpg"), decoded.photos)

        val reEncoded = json.encodeToString(decoded)
        assertEquals(ManicurePhotos(fingerRight = "a.jpg", fingerLeft = "b.jpg"), json.decodeFromString<Manicure>(reEncoded).photos)
    }

    @Test fun `editing an entry on Android does not touch fields it does not know about`() {
        val decoded = json.decodeFromString<Manicure>(fullManicureJson)

        // Simulates DiaryScreen's save path: only date/polishIds/notes/photos/updatedAt change.
        val edited = decoded.copy(notes = "Neue Notiz", updatedAt = 3000)

        assertEquals(decoded.polishRefs, edited.polishRefs)
        assertEquals(decoded.stickers, edited.stickers)
        assertEquals(decoded.stickerRefs, edited.stickerRefs)
        assertEquals(decoded.photos, edited.photos)
        assertEquals(decoded.photo, edited.photo)
    }
}
