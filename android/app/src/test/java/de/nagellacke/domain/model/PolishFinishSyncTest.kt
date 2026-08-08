package de.nagellacke.domain.model

import de.nagellacke.data.local.FinishListConverter
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Regression coverage for #192: a polish must support several finish values at once, and the
 * network JSON may still arrive in the old pre-migration shape (a bare finish string) from an
 * older server/client, or the new shape (a JSON array). [FlexibleFinishSerializer] (exercised
 * here indirectly through [Polish]'s `finish` field) must accept both.
 */
class PolishFinishSyncTest {
    private val json = Json { ignoreUnknownKeys = true }

    private fun polishJson(finishField: String) =
        """{"id":"p1","name":"Rose Gold","brand":"OPI","num":"","color":"#ffc0cb","finish":$finishField,"status":"ok","createdAt":1,"updatedAt":1}"""

    @Test fun `a bare finish string decodes as a single-element list`() {
        val decoded = json.decodeFromString<Polish>(polishJson("\"Glitter\""))
        assertEquals(listOf(FinishType.Glitter), decoded.finish)
    }

    @Test fun `a finish array decodes as-is, preserving order and dropping duplicates`() {
        val decoded = json.decodeFromString<Polish>(polishJson("""["Top Coat","Glitter","Top Coat"]"""))
        assertEquals(listOf(FinishType.TopCoat, FinishType.Glitter), decoded.finish)
    }

    @Test fun `unknown finish values inside an array are dropped, not crashing`() {
        val decoded = json.decodeFromString<Polish>(polishJson("""["Glitter","Sparkly Rainbow"]"""))
        assertEquals(listOf(FinishType.Glitter), decoded.finish)
    }

    @Test fun `an array of only unknown values normalizes to Classic`() {
        val decoded = json.decodeFromString<Polish>(polishJson("""["Sparkly Rainbow"]"""))
        assertEquals(listOf(FinishType.Classic), decoded.finish)
    }

    @Test fun `an unknown bare finish string normalizes to Classic`() {
        val decoded = json.decodeFromString<Polish>(polishJson("\"Sparkly Rainbow\""))
        assertEquals(listOf(FinishType.Classic), decoded.finish)
    }

    @Test fun `an empty finish array normalizes to Classic`() {
        val decoded = json.decodeFromString<Polish>(polishJson("[]"))
        assertEquals(listOf(FinishType.Classic), decoded.finish)
    }

    @Test fun `a missing finish field normalizes to Classic`() {
        val decoded = json.decodeFromString<Polish>(
            """{"id":"p1","name":"Rose Gold","brand":"OPI","num":"","color":"#ffc0cb","status":"ok","createdAt":1,"updatedAt":1}""",
        )
        assertEquals(listOf(FinishType.Classic), decoded.finish)
    }

    @Test fun `finish always re-encodes as a JSON array, never a bare string`() {
        val decoded = json.decodeFromString<Polish>(polishJson("\"Matte\""))
        val reEncoded = json.encodeToString(decoded)
        assertEquals(listOf(FinishType.Matte), json.decodeFromString<Polish>(reEncoded).finish)
        assert(reEncoded.contains("\"finish\":[\"Matte\"]"))
    }

    @Test fun `Room round-trip through FinishListConverter preserves multiple finishes`() {
        val converter = FinishListConverter()
        val original = listOf(FinishType.TopCoat, FinishType.Glitter, FinishType.Holographic)
        val roundTripped = converter.toFinishList(converter.fromFinishList(original))
        assertEquals(original, roundTripped)
    }

    @Test fun `FinishListConverter reads a lingering pre-migration bare-label string defensively`() {
        val converter = FinishListConverter()
        assertEquals(listOf(FinishType.GelLook), converter.toFinishList("Gel Look"))
    }

    @Test fun `FinishListConverter falls back to Classic for garbage input`() {
        val converter = FinishListConverter()
        assertEquals(listOf(FinishType.Classic), converter.toFinishList(""))
        assertEquals(listOf(FinishType.Classic), converter.toFinishList("Sparkly Rainbow"))
    }
}
