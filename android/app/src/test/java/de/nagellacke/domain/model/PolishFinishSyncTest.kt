package de.nagellacke.domain.model

import de.nagellacke.data.local.FinishListConverter
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
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

    // Regression coverage for the MIGRATION_2_3 cursor/write-interleaving bug (#192, #214): the
    // migration reads a row's raw `finish` column via `finishListFromJsonElement(JsonPrimitive(raw))`
    // — the same conversion `FinishListConverter.toFinishList` uses when its JSON-array parse fails
    // and it defensively retries the raw string as a bare label. That fallback treats the already-
    // converted JSON-array text as one big bare label, which no FinishType matches, so it silently
    // collapses to Classic. This is exactly what happened when Android's CursorWindow re-ran the
    // migration's SELECT mid-loop and re-read a row the migration had itself already converted.
    // The fix (materializing all rows before issuing any UPDATE) prevents an already-converted row
    // from ever being fed back through this path — this test documents why that ordering matters by
    // showing the raw conversion step is *not* safe to apply twice.
    @Test fun `applying the migration's raw finish conversion to already-converted output loses data`() {
        val converter = FinishListConverter()
        val original = "Glitter"
        val firstPass = converter.fromFinishList(finishListFromJsonElement(JsonPrimitive(original)))
        assertEquals("[\"Glitter\"]", firstPass)

        // Simulate a stale CursorWindow re-read handing the migration its own already-converted
        // output as if it were still the legacy bare-label column value.
        val secondPass = converter.fromFinishList(finishListFromJsonElement(JsonPrimitive(firstPass)))
        assertEquals("[\"Classic\"]", secondPass)
    }
}
